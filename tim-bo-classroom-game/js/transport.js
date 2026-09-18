/* Authenticated same-origin WebSocket transport. Requires the bundled Node server.
 * No silent local fallback: static hosting alone is not a multiplayer server. */
(function(global){
 'use strict';
 const GAME='cow';
 function create(){
  const handlers=new Set(),pending=new Map();let socket=null,room=null,player=null,ready=false,generation=0,retry=null,queue=[],round=null;
  function status(message){
   if(!global.document)return;
   let el=document.getElementById('connection-status');
   if(!el){el=document.createElement('div');el.id='connection-status';el.setAttribute('role','status');el.style.cssText='position:fixed;bottom:12px;left:12px;right:12px;z-index:9999;padding:12px;background:#fff3da;color:#493813;border:1px solid #c38c2b;border-radius:8px;font:15px system-ui';document.body.append(el)}
   el.textContent=message;el.hidden=!message;
  }
  function dispatch(e){if(!e||e.roomCode!==room)return;if(e.recipientId&&e.recipientId!=='all'&&e.recipientId!==player.id)return;
   if(player.role!=='teacher'&&e.senderRole!=='teacher')return;
   if(e.roundId)round=e.roundId;
   if(e.type==='answerResult')pending.delete(e.roundId+':'+e.payload.questionId);
   for(const h of handlers){try{h(e)}catch(err){console.error(err)}}
  }
  function transmit(e){if(ready&&socket?.readyState===1)socket.send(JSON.stringify(e));else {if(queue.length>=100)throw Error('Quá nhiều tin đang chờ kết nối.');queue.push(e)}}
  function announce(){if(player.role==='teacher')return;const type=GAME==='frog'?'joinRoom':'playerJoin';transmit({roomCode:room,type,payload:GAME==='chicken'?player:{player},roundId:round});}
  async function connect(gen){
   status('Đang kết nối lớp học…');
   try{
    const key='secure-room:'+GAME+':'+room+':'+player.id;
    let resumeToken;try{resumeToken=sessionStorage.getItem(key)}catch{}
    const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),8000);
    let response;try{response=await fetch('/api/join',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({roomCode:room,player,resumeToken}),signal:ctl.signal})}finally{clearTimeout(timer)}
    const result=await response.json();if(gen!==generation)return;
    if(!response.ok)throw Error(result.error||'Không thể vào phòng.');
    try{sessionStorage.setItem(key,result.resumeToken)}catch{}
    player.id=result.playerId;
    const ws=socket=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/room-socket');
    let openTimer=setTimeout(()=>ws.close(),8000);
    ws.onopen=()=>{if(gen!==generation){ws.close();return}ws.send(JSON.stringify({type:'authenticate',ticket:result.ticket}))};
    ws.onmessage=e=>{if(gen!==generation)return;let m;try{if(typeof e.data!=='string')return;m=JSON.parse(e.data)}catch{return}
     if(m.type==='ready'){clearTimeout(openTimer);ready=true;status('');announce();const waiting=queue;queue=[];waiting.forEach(transmit);for(const attempt of pending.values())transmit(attempt);return}
     if(m.type==='resync'){announce();return}dispatch(m);
    };
    ws.onclose=e=>{clearTimeout(openTimer);if(gen!==generation)return;ready=false;if(e.code===4001||e.code===1008){status('Kết nối đã dừng: '+e.reason+'. Hãy tải lại trang hoặc đăng nhập lại.');return}status('Mất kết nối. Đang kết nối lại…');retry=setTimeout(()=>connect(gen),2000)};
    ws.onerror=()=>status('Không kết nối được máy chủ lớp học. Đang thử lại…');
   }catch(e){if(gen!==generation)return;status('Không thể kết nối: '+e.message+' — Hãy kiểm tra mã phòng, máy chủ và đăng nhập giáo viên.');retry=setTimeout(()=>connect(gen),4000)}
  }
  function leave(){generation++;clearTimeout(retry);ready=false;const old=socket;socket=null;old?.close();queue=[];pending.clear();room=null;player=null;round=null}
  function join(code,p){leave();room=String(code||'').toUpperCase().trim();if(!/^[A-Z0-9]{4,8}$/.test(room))throw Error('Mã phòng phải có 4–8 chữ/số.');player={...p,role:p.role==='teacher'?'teacher':'student'};const gen=generation;connect(gen);return gen}
  function send(event,payload,options={}){
   if(!room)throw Error('Chưa vào phòng');
   if(typeof event==='string')event={type:event,payload,...options};
   const e={roomCode:room,type:event.type,payload:event.payload||{},recipientId:event.recipientId||null,roundId:event.roundId||round||null};
   if(e.type==='answerAttempt')pending.set(e.roundId+':'+e.payload.questionId,e);
   if(player.role==='teacher'&&e.roundId)round=e.roundId;
   transmit(e);
   return e;
  }
  return Object.freeze({join,send,leave,onEvent(h){handlers.add(h);return()=>handlers.delete(h)},getRoomCode:()=>room,getPlayer:()=>player?{...player}:null,getGeneration:()=>generation,isWebSocketMode:()=>true,destroy(){leave();handlers.clear()},get currentRoom(){return room},get player(){return player?{...player}:null}});
 }
 const api=Object.freeze({create,generateUUID:()=>crypto.randomUUID()});
 if(GAME==='cow')global.RoomTransport=api;else global.ClassroomTransport=api;
})(window);
