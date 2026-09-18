/**
 * Classroom Room Controller
 * Manages game authority, scoring, state synchronization, and room lifecycle.
 */
(function (global) {
  'use strict';

  function createRoomController({ role, transport }) {
    if (!['teacher', 'student'].includes(role)) throw new TypeError('Role must be teacher or student');

    let state = 'waiting'; // waiting | playing | ended
    let roomCode = null;
    let roundId = null;
    let questionBank = null;
    let learnerQuestions = [];
    let currentQuestionIndex = 0;
    let roster = new Map(); // playerId -> { id, name, score, correctCount, incorrectCount, currentQ, status }
    let answeredKeys = new Set(); // Set of "roundId:playerId:questionId"
    let localPlayer = null;

    const listeners = new Set();
    function notify(eventType, data) {
      listeners.forEach(l => {
        try { l(eventType, data); } catch (e) { console.error(e); }
      });
    }

    // Transport event handler
    transport.onEvent(envelope => {
      const { type, payload, senderId } = envelope;

      switch (type) {
        case 'joinRoom': {
          if (role === 'teacher') {
            const { player } = payload;
            if (player && typeof player.id === 'string' && player.id === senderId) {
              if(!roster.has(player.id) && roster.size >= 4) return;
              if (!roster.has(player.id)) {
                const safeName = String(player.name || 'Học sinh').slice(0, 30);
                roster.set(player.id, {
                  id: player.id,
                  name: safeName,
                  score: 0,
                  correctCount: 0,
                  incorrectCount: 0,
                  currentQ: 0,
                  status: 'ready'
                });
              }
              broadcastRoster();
              // Sync state back to joining student
              transport.send({
                recipientId: player.id,
                type: 'syncSnapshot',
                payload: getSnapshotForLearner(player.id)
              });
            }
          }
          break;
        }

        case 'rosterUpdate': {
          if (role === 'student') {
            const { list } = payload;
            roster.clear();
            list.forEach(p => roster.set(p.id, p));
            notify('rosterChange', list);
          }
          break;
        }

        case 'syncSnapshot': {
          if (role === 'student') {
            reconcileSnapshot(payload);
          }
          break;
        }

        case 'requestSync': {
          if (role === 'teacher') {
            const reqPlayerId = payload.playerId || senderId;
            transport.send({
              recipientId: reqPlayerId,
              type: 'syncSnapshot',
              payload: getSnapshotForLearner(reqPlayerId)
            });
          }
          break;
        }

        case 'startRound': {
          if (role === 'student') {
            state = 'playing';
            roundId = payload.roundId;
            learnerQuestions = payload.questions;
            currentQuestionIndex = payload.currentQuestionIndex || 0;
            notify('roundStarted', { roundId, questions: learnerQuestions, currentQuestionIndex });
          }
          break;
        }

        case 'answerAttempt': {
          if (role === 'teacher') {
            if (envelope.roundId === roundId) handleAnswerAttempt(payload, senderId);
          }
          break;
        }

        case 'answerResult': {
          if (role === 'student') {
            notify('answerResult', payload);
          }
          break;
        }

        case 'endGame': {
          if(role !== 'student') return;
          state = 'ended';
          notify('gameEnded', payload);
          break;
        }
      }
    });

    function persist() {
      if(role !== 'teacher' || !roomCode)return;
      try {sessionStorage.setItem('frog-state:'+roomCode,JSON.stringify({state,roundId,questionBank,roster:[...roster],answeredKeys:[...answeredKeys]}));}catch{}
    }
    function broadcastRoster() {
      persist();
      const list = Array.from(roster.values());
      transport.send({
        type: 'rosterUpdate',
        payload: { list }
      });
      notify('rosterChange', list);
    }

    function getSnapshotForLearner(playerId) {
      const playerRecord = roster.get(playerId) || null;
      return {
        roomCode,
        roundId,
        state,
        currentQuestionIndex,
        questions: learnerQuestions,
        playerRecord,
        rosterList: Array.from(roster.values())
      };
    }

    function reconcileSnapshot(snapshot) {
      if (!snapshot) return;
      state = snapshot.state;
      roundId = snapshot.roundId;
      currentQuestionIndex = snapshot.currentQuestionIndex;
      learnerQuestions = snapshot.questions || [];
      if (snapshot.rosterList) {
        roster.clear();
        snapshot.rosterList.forEach(p => roster.set(p.id, p));
        notify('rosterChange', snapshot.rosterList);
      }
      notify('snapshotReconciled', snapshot);
    }

    function handleAnswerAttempt(attempt, senderId) {
      if (state !== 'playing' || !attempt || !roster.has(senderId)) return;
      const playerId = senderId;
      if (attempt.playerId && attempt.playerId !== senderId) return;
      const {questionId, optionId} = attempt;
      const timeMs = Number.isFinite(attempt.timeMs) ? Math.min(300000,Math.max(0,attempt.timeMs)) : 0;
      const pRec = roster.get(playerId);
      const targetQ = questionBank?.questions[pRec.currentQ || 0];
      if (!targetQ || targetQ.id !== questionId || !targetQ.options.some(o=>o.id===optionId)) return;
      const key = `${roundId}:${playerId}:${questionId}`;
      if (answeredKeys.has(key)) return;
      answeredKeys.add(key);
      const isCorrect = targetQ.correctOptionId === optionId;
      const points = isCorrect ? (targetQ.points ?? 10) : 0;

      if (isCorrect) {
        pRec.score += points;
        pRec.correctCount++;
      } else {
        pRec.incorrectCount++;
      }
      pRec.currentQ = Math.min((pRec.currentQ || 0) + 1, questionBank.questions.length);

      // Send result back privately to the answering student
      transport.send({
        recipientId: playerId,
        type: 'answerResult',
        roundId,
        payload: {
          questionId,
          optionId,
          isCorrect,
          correctOptionId: targetQ.correctOptionId,
          explanation: targetQ.explanation || '',
          score: pRec.score,
          delta: points,
          timeMs
        }
      });

      broadcastRoster();
      notify('studentAnswered', { playerId, questionId, isCorrect, pRec });

      // Check if all active students have finished
      checkAllFinished();
    }

    function checkAllFinished() {
      if (!questionBank || roster.size === 0) return;
      const totalQ = questionBank.questions.length;
      let allDone = true;
      for (const p of roster.values()) {
        if ((p.correctCount + p.incorrectCount) < totalQ) {
          allDone = false;
          break;
        }
      }
      if (allDone) {
        endGame();
      }
    }

    function endGame() {
      state = 'ended';
      persist();
      const leaderboard = Array.from(roster.values())
        .sort((a, b) => b.score - a.score)
        .map((p, idx) => ({ ...p, rank: idx + 1 }));

      transport.send({
        type: 'endGame',
        payload: { roomCode, leaderboard }
      });
      notify('gameEnded', { roomCode, leaderboard });
    }

    return Object.freeze({
      initTeacher(code, bank) {
        roomCode = code.toUpperCase();
        questionBank = bank;
        learnerQuestions = global.ClassroomContentLoader.getLearnerSafeQuestions(bank);
        localPlayer = { id: 'teacher_' + Date.now(), name: 'Giáo viên', role: 'teacher' };
        transport.join(roomCode, localPlayer);
        state = 'waiting';
        try { const old=JSON.parse(sessionStorage.getItem('frog-state:'+roomCode)||'null');
          if(old){state=old.state;roundId=old.roundId;questionBank=old.questionBank;roster=new Map(old.roster);answeredKeys=new Set(old.answeredKeys);learnerQuestions=global.ClassroomContentLoader.getLearnerSafeQuestions(questionBank);}
        }catch{}
        queueMicrotask(()=>{broadcastRoster(); if(state==='ended')notify('gameEnded',{leaderboard:[...roster.values()].sort((a,b)=>b.score-a.score).map((p,i)=>({...p,rank:i+1}))});});
      },

      initStudent(code, name) {
        roomCode = code.toUpperCase();
        let savedId = global.sessionStorage.getItem(`student_id_${roomCode}`);
        if (!savedId) {
          savedId = 'stu_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
          global.sessionStorage.setItem(`student_id_${roomCode}`, savedId);
        }
        localPlayer = { id: savedId, name: name.trim(), role: 'student' };
        transport.join(roomCode, localPlayer);

        // Announce join
        transport.send({
          type: 'joinRoom',
          payload: { player: localPlayer }
        });
      },

      startRound() {
        if (role !== 'teacher' || state === 'playing' || !roster.size) return;
        state = 'playing';
        roundId = 'round_' + crypto.randomUUID();
        answeredKeys.clear();

        // Reset student scores for round
        roster.forEach(p => {
          p.score = 0;
          p.correctCount = 0;
          p.incorrectCount = 0;
          p.currentQ = 0;
          p.status = 'playing';
        });

        transport.send({
          type: 'startRound',
          roundId,
          payload: {
            roundId,
            questions: learnerQuestions,
            currentQuestionIndex: 0
          }
        });
        broadcastRoster();
        notify('roundStarted', { roundId, questions: learnerQuestions, currentQuestionIndex: 0 });
      },

      submitStudentAnswer(questionId, optionId, timeMs) {
        if (role !== 'student' || !localPlayer) return;
        transport.send({
          type: 'answerAttempt',
          roundId,
          payload: {
            playerId: localPlayer.id,
            questionId,
            optionId,
            timeMs: Number(timeMs) || 0
          }
        });
      },

      endGameDirectly() {
        if (role === 'teacher') {
          endGame();
        }
      },

      requestSync() {
        if (role === 'student' && localPlayer) {
          transport.send({
            type: 'requestSync',
            payload: { playerId: localPlayer.id }
          });
        }
      },

      on(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },

      get state() { return state; },
      get roomCode() { return roomCode; },
      get roundId() { return roundId; },
      get roster() { return Array.from(roster.values()); },
      get localPlayer() { return localPlayer; },
      get questionBank() { return questionBank; }
    });
  }

  global.ClassroomRoomController = Object.freeze({
    create: createRoomController
  });
})(window);
