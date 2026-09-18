'use strict';
// Authenticated relay for the three legacy teacher-authority games.
// Teacher sessions are trusted; this is not an SSO or durable scoring service.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');
const token = () => crypto.randomBytes(32).toString('hex');
const same = (a,b) => typeof a==='string' && typeof b==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
const validId = x => typeof x==='string' && /^[A-Za-z0-9_-]{1,64}$/.test(x) && !['__proto__','constructor','prototype'].includes(x);
const types = {
 frog: {student:['joinRoom','requestSync','answerAttempt'],teacher:['rosterUpdate','syncSnapshot','startRound','answerResult','endGame']},
 chicken: {student:['playerJoin','requestSnapshot','answerAttempt'],teacher:['roomSnapshot','gameStarted','answerResult','gameEnded']},
 motorbike: {student:[],teacher:[]}, tower: {student:[],teacher:[]},
 cow: {student:['playerJoin','answerAttempt','playerLeave'],teacher:['joinRejected','rosterUpdate','roomWelcome','gameStart','answerResult','gameEnd']}
};
function createServer({root,game,origins,password}) {
 if (!types[game]) throw Error('Unknown game');
 if (typeof password!=='string' || password.length<16) throw Error('TEACHER_PASSWORD must have at least 16 characters');
 const allowed = new Set(origins); const sessions=new Map(), rooms=new Map(), tickets=new Map(), rates=new Map();
 const now=()=>Date.now(), ttl=8*60*60*1000;
 function rate(key,max=60) { const t=now(); let r=rates.get(key); if(!r||t-r.time>60000){r={time:t,n:0};rates.set(key,r)}return ++r.n<=max; }
 function auth(req){const cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('cg_teacher='));const id=cookie?.slice(11);const s=sessions.get(id);return s&&s.expires>now()?id:null;}
 function originOK(req){return allowed.has(req.headers.origin)}
 function out(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
 async function body(req){let size=0,parts=[];for await(const part of req){size+=part.length;if(size>8192)throw Error('BODY_TOO_LARGE');parts.push(part)}return Buffer.concat(parts).toString()}
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','SAMEORIGIN');
  const ip=req.socket.remoteAddress;
  try {
   const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);
   if(pathname==='/login' && req.method==='GET'){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
    return res.end('<!doctype html><html lang="vi"><meta name="viewport" content="width=device-width"><title>Đăng nhập giáo viên</title><body style="font:18px system-ui;max-width:420px;margin:10vh auto;padding:24px"><h1>Đăng nhập giáo viên</h1><form method="post" action="/login"><label>Mật khẩu giáo viên <input name="password" type="password" required autocomplete="current-password" style="display:block;padding:12px;margin:16px 0"></label><button style="padding:12px">Đăng nhập</button></form></body></html>');
   }
   if(pathname==='/login' && req.method==='POST'){
    if(!originOK(req))return out(res,403,{error:'ORIGIN_DENIED'});
    if(!rate('login:'+ip,10))return out(res,429,{error:'RATE_LIMIT'});
    const p=new URLSearchParams(await body(req)).get('password');
    if(!same(p,password))return out(res,401,{error:'Sai mật khẩu giáo viên.'});
    const id=token();sessions.set(id,{expires:now()+ttl});
    res.setHeader('Set-Cookie',`cg_teacher=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${req.headers.origin.startsWith('https:')?'; Secure':''}`);
    res.writeHead(303,{Location:'/teacher.html'});return res.end();
   }
   if(pathname==='/api/join' && req.method==='POST'){
    if(!originOK(req))return out(res,403,{error:'ORIGIN_DENIED'});
    if(!rate('join:'+ip))return out(res,429,{error:'RATE_LIMIT'});
    const p=JSON.parse(await body(req));const code=String(p.roomCode||'').toUpperCase();
    if(!/^[A-Z0-9]{4,8}$/.test(code)||!validId(p.player?.id))return out(res,400,{error:'INVALID_ID'});
    const role=p.player.role==='teacher'?'teacher':'student';let room=rooms.get(code),member;
    if(role==='teacher'){
     const owner=auth(req);if(!owner)return out(res,401,{error:'Hãy đăng nhập giáo viên tại /login.'});
     if(room&&room.owner!==owner)return out(res,409,{error:'Mã phòng đã được sử dụng. Hãy tạo mã mới.'});
     if(!room){if(rooms.size>=200)return out(res,429,{error:'ROOM_LIMIT'});room={owner,members:new Map(),updated:now()};rooms.set(code,room)}
     member=room.teacher;
     if(!member){member={id:p.player.id,role,resumeToken:token(),socket:null};room.teacher=member}
    }else{
     if(!room)return out(res,404,{error:'Chưa tìm thấy phòng. Hãy kiểm tra mã và chờ giáo viên mở phòng.'});
     member=room.members.get(p.player.id);
     if(member&&!same(p.resumeToken,member.resumeToken))return out(res,403,{error:'IDENTITY_IN_USE'});
     if(!member){if(room.members.size>=4)return out(res,409,{error:'Phòng đã đủ 4 học sinh.'});member={id:p.player.id,role,resumeToken:token(),socket:null};room.members.set(member.id,member)}
    }
    room.updated=now();const ticket=token();tickets.set(ticket,{room,member,code,expires:now()+30000});
    return out(res,200,{ticket,resumeToken:member.resumeToken,playerId:member.id});
   }
   if(!['GET','HEAD'].includes(req.method))return out(res,405,{error:'METHOD_NOT_ALLOWED'});
   const name=pathname==='/'?'index.html':pathname.slice(1);
   const parts=name.split('/');
   if(parts.some(p=>!p||p==='..'||p.startsWith('.'))||name.includes('\\'))return out(res,404,{error:'NOT_FOUND'});
   // Never serve source of the server, dependency tree, docs, lockfiles or private kits.
   if(parts.some(p=>['node_modules','server','tests','shared','private'].includes(p))||!/^([\w-]+\.(html|js|css)|(?:assets|js|lib)\/[\w./-]+|content\.json)$/.test(name)||name==='server.js')return out(res,404,{error:'NOT_FOUND'});
   if(name==='content.json'||name==='teacher.html'||name==='admin.html'){
    if(!auth(req)){if(name.endsWith('.html')){res.writeHead(303,{Location:'/login'});return res.end()}return out(res,401,{error:'TEACHER_REQUIRED'})}
    res.setHeader('Cache-Control','private, no-store');
   }
   if(name.endsWith('.js'))res.setHeader('Access-Control-Allow-Origin','*'); // public modules in opaque-origin game iframes
   const file=name==='content.json'?path.resolve(root,'../private-content',path.basename(root)+'.json'):path.resolve(root,name);if(name!=='content.json'&&!file.startsWith(path.resolve(root)+path.sep))return out(res,404,{error:'NOT_FOUND'});
   const st=await fs.promises.stat(file).catch(()=>null);if(!st?.isFile())return out(res,404,{error:'NOT_FOUND'});
   const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.mp3':'audio/mpeg','.wav':'audio/wav','.webp':'image/webp'};
   res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.setHeader('Content-Length',st.size);
   if(req.method==='HEAD')return res.end();fs.createReadStream(file).pipe(res);
  }catch(e){if(!res.headersSent)out(res,400,{error:'INVALID_REQUEST'});else res.end()}
 });
 const wss=new WebSocketServer({noServer:true,maxPayload:65536,perMessageDeflate:false});
 server.on('upgrade',(req,socket,head)=>{
  if(req.url!=='/room-socket'||!originOK(req)||!rate('upgrade:'+req.socket.remoteAddress)){socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();return}
  wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
 });
 wss.on('connection',ws=>{
  let identity=null,count=0,start=now();const timer=setTimeout(()=>{if(!identity)ws.close(1008,'AUTH_REQUIRED')},5000);
  ws.on('close',()=>clearTimeout(timer));
  ws.on('message',(raw,binary)=>{
   try{
    if(binary)throw Error('TEXT_ONLY');if(now()-start>1000){start=now();count=0}if(++count>30)throw Error('RATE_LIMIT');
    const m=JSON.parse(raw.toString('utf8'));
    if(!identity){const t=tickets.get(m.ticket);if(m.type!=='authenticate'||!t||t.expires<now())throw Error('AUTH_REQUIRED');tickets.delete(m.ticket);identity=t;clearTimeout(timer);if(t.member.socket&&t.member.socket!==ws)t.member.socket.close(4001,'SESSION_REPLACED');t.member.socket=ws;ws.send(JSON.stringify({type:'ready'}));if(t.member.role==='teacher')for(const student of t.room.members.values())if(student.socket?.readyState===1)student.socket.send(JSON.stringify({type:'resync'}));return}
    const {room,member,code}=identity;
    if(member.socket!==ws||!sessions.has(room.owner)||sessions.get(room.owner).expires<now())throw Error('SESSION_EXPIRED');
    if(m.roomCode!==code||!types[game][member.role].includes(m.type))throw Error('FORBIDDEN');
    if(!m.payload||typeof m.payload!=='object'||Array.isArray(m.payload))throw Error('INVALID_PAYLOAD');
    room.updated=now();
    const e={eventId:token(),roomCode:code,roundId:typeof m.roundId==='string'?m.roundId:null,senderId:member.id,senderRole:member.role,type:m.type,payload:m.payload,recipientId:m.recipientId||null};
    if(member.role==='student'){
     // Only the authenticated teacher receives student input. Never broadcast client commands.
     e.recipientId=room.teacher.id;
     if(e.type==='answerAttempt'){
      const old=member.results?.get(e.roundId+':'+e.payload.questionId);
      if(old){ws.send(old);return}
     }
     if(m.type==='playerJoin'&&game==='chicken')e.payload={...m.payload,id:member.id};
     else if(m.type==='joinRoom'||m.type==='playerJoin')e.payload={player:{...m.payload.player,id:member.id,role:'student'}};
     else e.payload={...m.payload,playerId:member.id};
     if(room.teacher.socket?.readyState===1)room.teacher.socket.send(JSON.stringify(e));
    }else{
     if(m.type==='answerResult'&&!room.members.has(e.recipientId))throw Error('PRIVATE_RESULT_REQUIRED');
     const message=JSON.stringify(e);
     if(m.type==='answerResult'){
      const recipient=room.members.get(e.recipientId);
      if(!recipient.results)recipient.results=new Map();
      recipient.results.set(e.roundId+':'+e.payload.questionId,message);
      if(recipient.results.size>200)recipient.results.delete(recipient.results.keys().next().value);
     }
     for(const s of room.members.values())if(s.socket?.readyState===1&&(!e.recipientId||e.recipientId==='all'||e.recipientId===s.id))s.socket.send(message);
    }
   }catch(e){ws.close(1008,e.message.slice(0,100))}
  });
 });
 const cleanup=setInterval(()=>{
  const t=now();for(const [k,v] of sessions)if(v.expires<t)sessions.delete(k);
  for(const [k,v] of tickets)if(v.expires<t)tickets.delete(k);
  for(const [k,v] of rates)if(t-v.time>60000)rates.delete(k);
  for(const [k,r] of rooms)if(t-r.updated>ttl||!sessions.has(r.owner)){for(const m of [r.teacher,...r.members.values()])m?.socket?.close(1008,'ROOM_EXPIRED');rooms.delete(k)}
 },60000);cleanup.unref();server.on('close',()=>{clearInterval(cleanup);wss.close()});
 return {server,wss,rooms};
}
function start(root,game){const port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1';const origins=(process.env.ALLOWED_ORIGINS||`http://localhost:${port},http://127.0.0.1:${port}`).split(',').map(s=>s.trim());const {server}=createServer({root,game,origins,password:process.env.TEACHER_PASSWORD});server.listen(port,host,()=>console.log(`Open ${origins[0]}/ — teacher login: /login`))}
module.exports={createServer,start};
