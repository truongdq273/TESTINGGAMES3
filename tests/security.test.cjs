const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const fs=require('node:fs');const vm=require('node:vm');const {once}=require('node:events');const WS=require('ws');const {createServer}=require('../shared/secure-server.cjs');
const root=path.resolve(__dirname,'..');
function context(){const values=new Map();const c={console,crypto:require('node:crypto').webcrypto,queueMicrotask,setTimeout,clearTimeout,URL,TextDecoder,TextEncoder,AbortController,location:{href:'http://localhost/teacher.html',origin:'http://localhost'},sessionStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)},localStorage:{getItem:()=>null}};c.window=c;return vm.createContext(c)}
function load(c,file){vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),c)}
test('Authenticated relay isolates rooms, roles, private answers and public content',async t=>{
 const origin='http://localhost:19831';const {server,wss}=createServer({root:path.join(root,'ech-bat-muoi'),game:'frog',origins:[origin],password:'test-password-for-audit'});server.listen(19831,'127.0.0.1');await once(server,'listening');t.after(()=>{for(const c of wss.clients)c.terminate();server.close()});const base='http://127.0.0.1:19831';
 let r=await fetch(base+'/content.json');assert.equal(r.status,401);
 r=await fetch(base+'/server.js');assert.equal(r.status,404);
 r=await fetch(base+'/node_modules/ws/index.js');assert.equal(r.status,404);
 r=await fetch(base+'/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:'password=test-password-for-audit',redirect:'manual'});assert.equal(r.status,303);const cookie=r.headers.get('set-cookie').split(';')[0];
 r=await fetch(base+'/content.json',{headers:{Cookie:cookie}});assert.equal(r.status,200);assert.ok((await r.json()).questions[0].correctOptionId);
 const join=async(player,roomCode='TEST01',resumeToken=null,cookieValue='')=>{const r=await fetch(base+'/api/join',{method:'POST',headers:{Origin:origin,Cookie:cookieValue,'Content-Type':'application/json'},body:JSON.stringify({roomCode,player,resumeToken})});return {status:r.status,...await r.json()}};
 assert.equal((await join({id:'teacher',role:'teacher'})).status,401);
 const ti=await join({id:'teacher',role:'teacher'},'TEST01',null,cookie);assert.equal(ti.status,200);
 const si=await join({id:'student',role:'student'});assert.equal(si.status,200);
 assert.equal((await join({id:'student',role:'student'})).status,403);
 const open=async(ticket)=>{const w=new WS('ws://127.0.0.1:19831/room-socket',{origin});await once(w,'open');const ready=once(w,'message');w.send(JSON.stringify({type:'authenticate',ticket}));assert.equal(JSON.parse((await ready)[0]).type,'ready');return w};
 const tw=await open(ti.ticket),sw=await open(si.ticket);
 const got=once(tw,'message');sw.send(JSON.stringify({roomCode:'TEST01',senderId:'victim',type:'answerAttempt',roundId:'r1',payload:{playerId:'victim',questionId:'q1',optionId:'a'}}));const [raw,binary]=await got;assert.equal(binary,false);const msg=JSON.parse(raw);assert.equal(msg.senderId,'student');assert.equal(msg.payload.playerId,'student');
 const result=once(sw,'message');tw.send(JSON.stringify({roomCode:'TEST01',type:'answerResult',roundId:'r1',recipientId:'student',payload:{questionId:'q1',correctOptionId:'a'}}));assert.equal(JSON.parse((await result)[0]).type,'answerResult');
 const closed=once(sw,'close');sw.send(JSON.stringify({roomCode:'TEST01',type:'endGame',payload:{}}));assert.equal((await closed)[0],1008);
 const si2=await join({id:'student',role:'student'},'TEST01',si.resumeToken);assert.equal(si2.status,200);const sw2=await open(si2.ticket);const closed2=once(sw2,'close');sw2.send(JSON.stringify({roomCode:'OTHER1',type:'answerAttempt',payload:{}}));assert.equal((await closed2)[0],1008);
 const outsider=new WS('ws://127.0.0.1:19831/room-socket',{origin});await once(outsider,'open');const denied=once(outsider,'close');outsider.send(JSON.stringify({roomCode:'TEST01',type:'endGame',payload:{}}));assert.equal((await denied)[0],1008);
});
test('Frog rejects pre-start, spoofed IDs, stale rounds, wrong question, invalid option and duplicate attempts',()=>{
 const c=context();load(c,'ech-bat-muoi/content-loader.js');load(c,'ech-bat-muoi/room-controller.js');let handler;const sent=[];const tr={join(){},onEvent(h){handler=h},send(e){sent.push(e)}};const bank={questions:[{id:'q1',correctOptionId:'a',options:[{id:'a',text:'A'},{id:'b',text:'B'}],points:10},{id:'q2',correctOptionId:'a',options:[{id:'a',text:'A'},{id:'b',text:'B'}],points:10}]};const teacher=c.ClassroomRoomController.create({role:'teacher',transport:tr});teacher.initTeacher('TEST01',bank);
 const attempt=(extra={})=>handler({type:'answerAttempt',senderId:'s1',roundId:teacher.roundId,payload:{playerId:'s1',questionId:'q1',optionId:'a',timeMs:1},...extra});attempt();assert.equal(teacher.roster.length,0);handler({type:'joinRoom',senderId:'s1',payload:{player:{id:'s1',name:'Minh'}}});attempt();assert.equal(teacher.roster[0].score,0);teacher.startRound();attempt({roundId:'old'});attempt({payload:{playerId:'other',questionId:'q1',optionId:'a'}});attempt({payload:{questionId:'q2',optionId:'a'}});attempt({payload:{questionId:'q1',optionId:'invalid'}});assert.equal(teacher.roster[0].score,0);attempt();attempt();assert.equal(teacher.roster[0].score,10);teacher.endGameDirectly();attempt({payload:{questionId:'q2',optionId:'a'}});assert.equal(teacher.roster[0].score,10);
});
test('Chicken validates avatar and escapes podium, rejects stale round',()=>{
 const c=context();load(c,'space-chicken-shooter/content-loader.js');load(c,'space-chicken-shooter/room-controller.js');let handler;const tr={join(){},onEvent(h){handler=h},send(){}};const ctrl=c.RoomController.createTeacherController({transport:tr,contentData:{questions:[{id:'q1',correctOptionId:'a',options:[{id:'a',text:'A'}],points:10}]}});ctrl.initRoom('TEST02');handler({roomCode:'TEST02',type:'playerJoin',payload:{id:'s1',name:'<svg onload=x>',avatar:'" onerror=x'}});assert.equal(ctrl.getSnapshot().roster[0].avatar,'avatar-cadet-red.png');ctrl.startGame();handler({roomCode:'TEST02',type:'answerAttempt',roundId:'old',senderId:'s1',payload:{questionId:'q1',answer:'a'}});assert.equal(ctrl.getSnapshot().roster[0].score,0);const html=fs.readFileSync(path.join(root,'space-chicken-shooter/teacher.html'),'utf8');assert.ok(!html.includes('${p.name}'));assert.ok(!html.includes("${p.avatar ||"));
});
test('All legacy loaders cap streaming bytes and keep deadline while reading body',async()=>{
 for(const file of ['ech-bat-muoi/content-loader.js','space-chicken-shooter/content-loader.js','tim-bo-classroom-game/js/content-loader.js']){
  const c=context();load(c,file); // expose closure helper only in test, preserving implementation bytes
  const src=fs.readFileSync(path.join(root,file),'utf8').replace("  async function readSource", "  global.testRead = readSource;\n  async function readSource");vm.runInContext(src,c);
  let cancelled=false;c.fetch=async()=>({ok:true,headers:{get:()=>null},body:{getReader:()=>({read:async()=>({value:new Uint8Array(1048577),done:false}),cancel:async()=>{cancelled=true},releaseLock(){}})}});
  await assert.rejects(()=>c.testRead('./content.json'),/1 MiB/);assert.equal(cancelled,true);
  c.fetch=async(url,{signal})=>({ok:true,headers:{get:()=>null},body:{getReader:()=>({read:()=>new Promise((resolve,reject)=>{if(signal.aborted)reject(Error('aborted'));else signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true})}),cancel:async()=>{},releaseLock(){}})}});
  await assert.rejects(()=>c.testRead('./content.json',undefined,10),/aborted/);
  const ac=new AbortController();ac.abort();await assert.rejects(()=>c.testRead('./content.json',ac.signal,10),/aborted/);
 }
});
