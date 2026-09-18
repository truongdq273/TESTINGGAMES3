const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const {once}=require('node:events');const WS=require('ws');const {createServer}=require('../shared/secure-server.cjs');const root=path.resolve(__dirname,'..');
const waitFor=async fn=>{const end=Date.now()+3500;while(!fn()){if(Date.now()>end)throw Error('Timed out waiting for game state');await new Promise(r=>setTimeout(r,10))}};
for(const [i,kind,dir] of [[0,'frog','ech-bat-muoi'],[1,'chicken','space-chicken-shooter'],[2,'cow','tim-bo-classroom-game']])test(kind+': real HTTP/WS, teacher + four isolated students, grade once, private results',async t=>{
 const port=19840+i,origin='http://127.0.0.1:'+port;const {server,wss}=createServer({root:path.join(root,dir),game:kind,origins:[origin],password:'integration-test-password'});server.listen(port,'127.0.0.1');await once(server,'listening');const transports=[];t.after(()=>{transports.forEach(tr=>tr.leave());for(const ws of wss.clients)ws.terminate();server.close()});
 const res=await fetch(origin+'/login',{method:'POST',headers:{Origin:origin},body:'password=integration-test-password',redirect:'manual'});const cookie=res.headers.get('set-cookie').split(';')[0];
 function context(teacher){const storage=new Map();const c={console,crypto:require('node:crypto').webcrypto,URL,TextDecoder,TextEncoder,AbortController,queueMicrotask,setTimeout,clearTimeout,location:{href:origin+'/teacher.html',origin,protocol:'http:',host:'127.0.0.1:'+port},sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},fetch:(url,opts={})=>fetch(new URL(url,origin),{...opts,headers:{...opts.headers,Origin:origin,...(teacher?{Cookie:cookie}:{})}}),WebSocket:class extends WS{constructor(url){super(url,{origin})}}};c.window=c;return vm.createContext(c)}
 function load(c,f){vm.runInContext(fs.readFileSync(path.join(root,dir,f),'utf8'),c)}
 const tc=context(true);const prefix=kind==='cow'?'js/':'';load(tc,prefix+'content-loader.js');load(tc,prefix+'transport.js');load(tc,prefix+'room-controller.js');const tr=(kind==='cow'?tc.RoomTransport:tc.ClassroomTransport).create();transports.push(tr);const bank=JSON.parse(fs.readFileSync(path.join(root,'private-content',dir+'.json')));let controller;
 if(kind==='frog'){controller=tc.ClassroomRoomController.create({role:'teacher',transport:tr});controller.initTeacher('TEST42',bank)}else if(kind==='chicken'){controller=tc.RoomController.createTeacherController({transport:tr,contentData:bank});controller.initRoom('TEST42')}else{tr.join('TEST42',{id:'teacher',role:'teacher',name:'Teacher'});controller=tc.RoomController.createTeacherController(tr,bank)}
 const roster=()=>kind==='frog'?controller.roster:kind==='chicken'?controller.getSnapshot().roster:controller.getRoster();
 // Wait for teacher registration, then start independent student browser contexts.
 await waitFor(()=>[...wss.clients].length>0);await new Promise(r=>setTimeout(r,30));const students=[];
 for(let n=0;n<4;n++){const c=context(false);load(c,prefix+'transport.js');const st=(kind==='cow'?c.RoomTransport:c.ClassroomTransport).create();transports.push(st);const messages=[];st.onEvent(e=>messages.push(e));st.join('TEST42',{id:'student'+n,role:'student',name:'Minh'});students.push({st,messages})}
 await waitFor(()=>roster().length===4);if(kind==='frog')controller.startRound();else controller.startGame();
 await waitFor(()=>students.every(s=>s.messages.some(m=>['startRound','gameStarted','gameStart'].includes(m.type))));
 const round=kind==='frog'?controller.roundId:controller.getSnapshot().roundId;const q=bank.questions[0];
 const e={type:'answerAttempt',roundId:round,payload:{playerId:'student0',questionId:q.id,...(kind==='frog'?{optionId:q.correctOptionId}:{answer:q.correctOptionId}),timeMs:10}};students[0].st.send(e);
 await waitFor(()=>roster()[0].score===q.points);await waitFor(()=>students[0].messages.some(m=>m.type==='answerResult'));
 assert.equal(students.slice(1).some(s=>s.messages.some(m=>m.type==='answerResult')),false);
 students[0].st.send(e);await new Promise(r=>setTimeout(r,30));assert.equal(roster()[0].score,q.points);
 assert.ok(students.every(s=>s.messages.filter(m=>m.type!=='answerResult').every(m=>!JSON.stringify(m).includes('correctOptionId'))));
});
