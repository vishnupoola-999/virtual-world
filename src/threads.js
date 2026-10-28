// Accept/decline + private two-person chats (backend PR #51). Pure helpers are exported for tests; setupThreads owns the chat screen.
import {toLook,CREATURE_COLOURS} from './character-data.js';
export const API='https://virtual-world-ai.onrender.com';
export const TEXT_MAX=1000,LINES_MAX=20,POLL_MS=4000,POLL_HIDDEN_MS=30000;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function call(user,path,{method='GET',body}={}){const t=await user.getIdToken();
  const r=await fetch(API+path,{method,headers:{Authorization:'Bearer '+t,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  let j=null;try{j=await r.json();}catch{/* empty body */}
  if(!r.ok){const e=new Error(j?.error||('http '+r.status));e.status=r.status;e.error=j?.error||'';throw e;}return j||{};}
export const respondConnect=(u,connectId,action)=>call(u,'/connect/respond',{method:'POST',body:{connectId,action}});
export const fetchThreads=u=>call(u,'/threads').then(j=>({myId:j.myId||null,threads:Array.isArray(j.threads)?j.threads.filter(t=>t&&t.id):[]}));
export const fetchMessages=(u,id,after)=>call(u,`/threads/${encodeURIComponent(id)}/messages`+(after?`?after=${after}`:'')).then(j=>({messages:Array.isArray(j.messages)?j.messages:[],more:!!j.more,...presenceOf(j)}));
// Presence (Chat API v4, #57): typingUntil, receipts, seenUpTo, messages[].status. Older fields stay as feature-detected fallbacks;
// absent fields show nothing. receipts:false hides Seen (receipts are mutual).
export function presenceOf(j){const o={};const tu=+j?.typingUntil;
  if(j&&'typingUntil' in j&&Number.isFinite(tu)){o.typingUntil=tu;o.typing=tu>Date.now();}
  else if(typeof j?.typing==='boolean')o.typing=j.typing;else if(Number.isFinite(+j?.typingAt)&&j?.typingAt!==null)o.typing=Date.now()-(+j.typingAt)<3000;
  if(j?.receipts===false||j?.readReceipts===false){o.receipts=false;o.readAt=undefined;return o;}
  let r=j?.seenUpTo??j?.theirReadAt??j?.readAt?.them;r=r===null||r===undefined?NaN:+r;
  for(const m of Array.isArray(j?.messages)?j.messages:[])if(m?.from==='me'&&m.status==='seen'&&+m.at>(Number.isFinite(r)?r:-1))r=+m.at;
  if(Number.isFinite(r))o.readAt=r;if(j?.receipts===true)o.receipts=true;return o;}
export const markRead=(u,id,upTo)=>call(u,`/threads/${encodeURIComponent(id)}/read`,{method:'POST',body:{upTo}});
export const getChatSettings=(u)=>call(u,'/me/chat-settings');
export const setChatSettings=(u,readReceipts)=>call(u,'/me/chat-settings',{method:'POST',body:{readReceipts:!!readReceipts}});
export const sendTyping=(u,id)=>call(u,`/threads/${encodeURIComponent(id)}/typing`,{method:'POST',body:{}});
export const postMessage=(u,id,text)=>call(u,`/threads/${encodeURIComponent(id)}/messages`,{method:'POST',body:{text}});
// A null or old look falls back to a deterministic default creature from the name.
export const lookOf=(look,name)=>toLook(look||null,name||'');
export const BLOCKED='Links and contact details can\'t be shared here yet.',SLOW='Slow down a little, try again in a minute';
export function sendError(x){if(x?.status===400&&/not allowed/i.test(x.error||''))return BLOCKED;if(x?.status===429)return SLOW;if(x?.status===400)return 'That message is too long.';return 'Couldn\'t send. Try again.';}
export function checkText(s){const t=String(s||'');if(!t.trim())return 'empty';if(t.length>TEXT_MAX)return 'That message is too long.';if(t.split('\n').length>LINES_MAX)return 'Too many lines.';return '';}
// Merge newly polled messages (oldest first), deduped by id.
export function mergeMsgs(old,add){const m=new Map(old.map(x=>[x.id,x]));for(const x of add||[])if(x&&x.id)m.set(x.id,x);return [...m.values()].sort((a,b)=>(+a.at||0)-(+b.at||0));}
export const lastAt=list=>list.length?Math.max(...list.map(x=>+x.at||0)):0;
// Real 3D creature portraits (creature + accessory + colour). face: -1 looks left, 1 looks right, 0 three-quarter.
export function avatar(look,cls='cav',face=0){const l=lookOf(look);return `<span class="${cls}" style="--c:${l.color||CREATURE_COLOURS[l.creature]}" data-cr="${l.creature}" data-look="${esc(JSON.stringify(l))}" data-face="${face}"><img alt=""></span>`;}
export const interestsOf=w=>(Array.isArray(w?.interests)?w.interests:[]).filter(x=>typeof x==='string').slice(0,3);
export const ago=at=>{const m=Math.max(0,(Date.now()-(+at||0))/60000);if(m<1)return 'now';if(m<60)return Math.round(m)+'m';const h=m/60;if(h<24)return Math.round(h)+'h';const d=Math.round(h/24);return d<7?d+'d':new Date(+at).toLocaleDateString(undefined,{day:'numeric',month:'short'});};
// v4 row: 44px creature face, name (600 when unread), last line, time, 8px dot only for real unread.
export function friendRow(t){const w=t.with||{},look=lookOf(w.look,w.name),ints=interestsOf(w),l=t.last,un=+t.unread>0;
  const line=l&&l.text?(l.from==='me'?'You: ':'')+String(l.text).slice(0,80):ints.join(' · ');
  return `<li class="fr${un?' un':''}" data-thread="${esc(t.id)}"><button type="button" class="frBtn">${avatar(look,'cav face')}<span class="frMain"><b>${esc(w.name||'Friend')}</b><small>${esc(line)}</small></span><span class="frSide"><time>${l?.at?ago(l.at):''}</time>${un?`<i class="udot" aria-label="${Math.min(+t.unread,99)} unread"></i>`:''}</span></button></li>`;}
export function friendsHtml(threads){if(!threads?.length)return '';return `<div class="v4Sec frSec"><div class="capLbl">Friends</div><ul>${threads.map(friendRow).join('')}</ul></div>`;}
// Message groups: same sender within 5 min. Timestamps only on gaps over 5 min.
export const GROUP_MS=300000;
export function groupMsgs(list){const out=[];let prev=null;for(const m of list){const gap=!prev||(+m.at||0)-(+prev.at||0)>GROUP_MS;const same=prev&&!gap&&prev.from===m.from&&m.from!=='system';
  out.push({m,stamp:gap&&!!prev,first:!same});prev=m;}return out;}
const TICK='<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>';
export const HEART='<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="#ff5a7a" d="M12 21s-7.5-4.6-9.6-9.3C.9 8.2 3.1 4.5 6.7 4.5c2.1 0 3.6 1.2 5.3 3.1 1.7-1.9 3.2-3.1 5.3-3.1 3.6 0 5.8 3.7 4.3 7.2C19.5 16.4 12 21 12 21z"/></svg>';
const dayStamp=at=>{const d=new Date(+at||0),t=d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0');return new Date().toDateString()===d.toDateString()?t:d.toLocaleDateString(undefined,{weekday:'short'})+' '+t;};
export function msgHtml(m,meLook,themLook,{first=true,stamp=false,react=false}={}){
  const ts=stamp?`<li class="stamp">${dayStamp(m.at)}</li>`:'';
  if(m.from==='system')return ts+`<li class="sys" data-id="${esc(m.id)}"><span>${esc(m.text)}</span></li>`;
  const st=m.from==='me'&&m.state?(m.state==='failed'?`<small class="mst fail" role="alert">Not sent · <button type="button" class="retry">Retry</button></small>`:m.state==='sending'?`<small class="mst">Sending</small>`:''):'';
  return ts+`<li class="msg ${m.from==='me'?'me':'them'}${first?' first':''}${m.state==='sending'?' sending':''}${m.fresh?' rise':''}" data-id="${esc(m.id)}"><p>${esc(m.text)}${react?`<span class="rx">${HEART}</span>`:''}</p>${st}</li>`;}
export const tickHtml=TICK;
// Openers for a first chat, from shared interests (or a friendly generic set).
export function openers(shared){const s=(shared||[]).filter(Boolean);const T=[x=>`Seen anything good about ${x} lately?`,x=>`What got you into ${x}?`,x=>`Any ${x} plans this week?`];
  const g=['What are you up to this week?','How did your agents get talking?','What is your favourite spot around here?'];
  return [0,1,2].map(i=>s.length?T[i](s[i%s.length]):g[i]);}
// Header line 2: "Met 2 days ago · Both like space, music". metAt and sharedInterests come from /threads when the backend sends them;
// shared interests fall back to the overlap of both profiles; the Met part is hidden without metAt.
export function sharedOf(t,mine){if(Array.isArray(t?.sharedInterests))return t.sharedInterests.filter(x=>typeof x==='string').slice(0,3);
  const a=new Set((mine||[]).map(x=>String(x).toLowerCase()));return interestsOf({interests:(t?.with?.interests||[]).filter(x=>a.has(String(x).toLowerCase()))});}
export function metLine(t,mine){const parts=[];const at=+t?.metAt;if(at>0){const d=Math.floor((Date.now()-at)/86400000);parts.push(esc('Met '+(d<1?'today':d===1?'yesterday':d+' days ago')));}
  const sh=sharedOf(t,mine);if(sh.length)parts.push(`Both like <b>${sh.map(esc).join(', ')}</b>`);return parts.join(' · ');}
// Fill creature thumbnails lazily (three.js stays off the startup path); the coloured circle shows until then.
export function fillAvatars(root){const els=[...(root?.querySelectorAll?.('.cav img:not([src])')||[])];if(!els.length)return;
  import('./cards3d.js').then(m=>{let i=0;const step=()=>{const t0=performance.now();while(i<els.length&&performance.now()-t0<8){const img=els[i++],p=img.parentElement;let l=null;try{l=JSON.parse(p.dataset.look||'null');}catch{/* bad look */}
      const u=m.lookThumb(l,{face:+p.dataset.face||0,size:p.classList.contains('xl')?160:p.classList.contains('lg')?112:72});if(u)img.src=u;}if(i<els.length)requestAnimationFrame(step);};step();}).catch(()=>{});}

const BACK='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
const UP='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
const buzz=p=>{try{navigator.vibrate?.(p);}catch{/* no haptics */}};
const RX_KEY='vw-rx';const rxStore=()=>{try{return new Set(JSON.parse(localStorage.getItem(RX_KEY)||'[]'));}catch{return new Set();}};
export function setupThreads({getUser,agents,getMe=()=>null,deps={}}){const F={fetchThreads,fetchMessages,postMessage,respondConnect,sendTyping,markRead,...deps};
  let u0=null;const U=()=>{const g=getUser();return g&&!g.isAnonymous?g:(u0||g);};
  let list=[],myLook=null,open=null,timer=0,msgs=[],cool=0,pres={},typT=0,lastTyp=0,typingOk=true;const friends=new Set(),local=new Map(),rx=rxStore();
  const v=document.createElement('section');v.id='dmView';v.hidden=true;v.setAttribute('role','dialog');v.setAttribute('aria-label','Chat');
  v.innerHTML=`<header class="dmHead"><button type="button" class="dmBack" aria-label="Back">${BACK}</button><span class="dmPair"></span><span class="dmWho"><b></b><small class="dmLive"></small></span><p class="dmMet"></p></header><ul class="dmList" aria-live="polite"></ul><div class="dmTyping" hidden aria-label="typing"><i></i><i></i><i></i></div><div class="dmOpeners" hidden></div><form class="dmForm"><small class="dmNote" role="status"></small><div class="dmRow"><textarea rows="1" maxlength="${TEXT_MAX}" aria-label="Message" placeholder="Message"></textarea><button type="submit" class="dmSend" aria-label="Send">${UP}</button></div></form>`;
  document.body.appendChild(v);const $=s=>v.querySelector(s),ta=$('textarea'),note=$('.dmNote'),sb=$('.dmSend'),ul=$('.dmList'),typ=$('.dmTyping'),ops=$('.dmOpeners');
  const meLook=()=>myLook||agents?.get('me')?.look||getMe()?.look||null;
  function ring(){for(const id of friends)agents?.get(id)?.el?.classList.add('friend');}
  async function load(u){if(u)u0=u;u=U();try{const r=await F.fetchThreads(u);list=r.threads;friends.clear();for(const t of list)if(t.with?.id)friends.add(t.with.id);ring();}catch(e){console.warn('threads',e?.message);list.err=true;throw e;}return list;}
  const all=()=>mergeMsgs(msgs,[...local.values()]);
  function draw(){const t=open,w=t.with||{},tl=lookOf(w.look,w.name),ml=meLook(),list=all();const g=groupMsgs(list);
    // Seen: only with a real read position from the backend (hidden when either side turned receipts off).
    let seenId=null;if(Number.isFinite(pres.readAt)){for(const m of list)if(m.from==='me'&&!m.state&&(+m.at||0)<=pres.readAt)seenId=m.id;}
    const lastMine=[...list].reverse().find(m=>m.from==='me');
    ul.innerHTML=g.map(({m,first,stamp})=>msgHtml(m,ml,tl,{first,stamp,react:rx.has(t.id+'|'+m.id)})
      +(m.id===seenId?`<li class="rcpt">Seen ${avatar(tl,'cav xs',-1)}</li>`:m===lastMine&&!m.state&&seenId===null?`<li class="rcpt">${tickHtml} Sent</li>`:'')).join('');
    for(const m of local.values())m.fresh=false;fillAvatars(ul);
    const chat=list.some(m=>m.from!=='system');ops.hidden=chat||!list.length;if(!ops.hidden&&!ops.childElementCount){const sh=sharedOf(t,getMe()?.interests);ops.innerHTML=openers(sh).map(o=>`<button type="button" class="opener">${esc(o)}</button>`).join('');}
    ul.scrollTop=ul.scrollHeight;}
  function showTyping(on,until){typ.hidden=!on;clearTimeout(typT);const off=()=>{typ.hidden=true;$('.dmLive').textContent='';};if(on)typT=setTimeout(off,until>Date.now()?Math.min(until-Date.now(),6000):3000);$('.dmLive').textContent=on?'typing…':'';}
  async function poll(){clearTimeout(timer);if(!open)return;const id=open.id;
    try{const r=await F.fetchMessages(U(),id,lastAt(msgs)||undefined);if(open?.id!==id)return;const n=msgs.length;msgs=mergeMsgs(msgs,r.messages);
      for(const [k,lm] of local)if(lm.state==='sent'&&msgs.some(m=>m.from==='me'&&m.text===lm.text&&(+m.at||0)>=lm.at-60000))local.delete(k);
      const pr=pres;pres=r.receipts===false?{receipts:false}:{...pres,...(r.readAt!==undefined?{readAt:r.readAt}:{})};if('typing' in r)showTyping(r.typing,r.typingUntil);
      const lt=msgs.reduce((a,m)=>m.from!=='me'&&+m.at>a?+m.at:a,0);if(readOk&&lt>readUp&&!document.hidden&&Date.now()-lastRead>1000){readUp=lt;lastRead=Date.now();F.markRead(U(),id,lt).catch(x=>{if(x?.status===404||x?.status===405)readOk=false;else readUp=0;});}
      if(msgs.length!==n||pr.readAt!==pres.readAt)draw();}catch(e){console.warn('messages',e?.message);}
    if(open?.id===id)timer=setTimeout(poll,document.hidden?POLL_HIDDEN_MS:POLL_MS);}
  async function openThread(id,known){let t=known||list.find(x=>x.id===id);if(!t){try{await load();}catch{/* offline */}t=list.find(x=>x.id===id)||{id,with:{}};}
    open=t;msgs=[];local.clear();pres={};readUp=0;if(Number.isFinite(+t.theirReadAt))pres.readAt=+t.theirReadAt;ops.innerHTML='';showTyping(false);const w=t.with||{};
    $('.dmPair').innerHTML=avatar(meLook(),'cav hd',1)+avatar(lookOf(w.look,w.name),'cav hd',-1);fillAvatars($('.dmPair'));
    $('.dmWho b').textContent=w.name||'Friend';const ml=metLine(t,getMe()?.interests);$('.dmMet').innerHTML=ml;$('.dmMet').hidden=!ml;
    ta.placeholder='Message '+(w.name||'');note.textContent='';ul.innerHTML='';v.hidden=false;document.body.classList.add('dmOpen');
    requestAnimationFrame(()=>v.classList.add('on'));sync();await poll();if(!msgs.length)draw();return t;}
  function close(){open=null;clearTimeout(timer);showTyping(false);v.classList.remove('on');v.hidden=true;document.body.classList.remove('dmOpen');onClose?.();}
  let onClose=null,readOk=true,readUp=0,lastRead=0;
  function sync(){const e=checkText(ta.value),c=Date.now()<cool;sb.disabled=!!e||c;v.classList.toggle('cool',c);v.classList.toggle('has',!e);}
  ta.addEventListener('input',()=>{if(note.dataset.k==='blocked'){note.textContent='';note.dataset.k='';}const e=checkText(ta.value);if(e&&e!=='empty'){note.textContent=e;note.dataset.k='len';}else if(note.dataset.k==='len'){note.textContent='';note.dataset.k='';}sync();
    ta.style.height='';ta.style.height=Math.min(ta.scrollHeight,120)+'px';
    // Typing events (POST /threads/:id/typing, server allows one per 2 s): at most one every 2.5 s; 404/405 turns them off for the session.
    if(open&&typingOk&&ta.value&&Date.now()-lastTyp>2500){lastTyp=Date.now();F.sendTyping(U(),open.id).catch(x=>{if(x?.status===404||x?.status===405)typingOk=false;});}});
  ta.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!matchMedia('(pointer:coarse)').matches){e.preventDefault();$('.dmForm').requestSubmit();}});
  async function send(text,lm){const id=open.id;try{await F.postMessage(U(),id,text);if(open?.id!==id)return;lm.state='sent';lm.fresh=false;draw();poll();return true;}
    catch(x){if(open?.id!==id)return;if(x?.status===400||x?.status===429){local.delete(lm.id);if(!ta.value)ta.value=text;// never lose what they typed
        note.textContent=sendError(x);note.dataset.k=x?.status===429?'slow':'blocked';
        if(x?.status===429){cool=Date.now()+60000;setTimeout(()=>{if(note.dataset.k==='slow'){note.textContent='';note.dataset.k='';}sync();},60000);}}
      else lm.state='failed';draw();sync();return false;}}
  $('.dmForm').addEventListener('submit',e=>{e.preventDefault();if(!open||sb.disabled)return;const text=ta.value;buzz(10);
    const lm={id:'local-'+Date.now(),from:'me',text,at:Date.now(),state:'sending',fresh:true};local.set(lm.id,lm);ta.value='';ta.style.height='';note.textContent='';note.dataset.k='';sync();draw();send(text,lm);});
  ul.addEventListener('click',e=>{const r=e.target.closest('.retry');if(!r)return;const lm=local.get(r.closest('.msg').dataset.id);if(!lm)return;lm.state='sending';draw();send(lm.text,lm);});
  // Double-tap a bubble: heart reaction (kept on this device until the backend stores reactions).
  ul.addEventListener('dblclick',e=>{const b=e.target.closest('.msg');if(!b||!open||b.dataset.id.startsWith('local-'))return;const k=open.id+'|'+b.dataset.id;rx.has(k)?rx.delete(k):rx.add(k);try{localStorage.setItem(RX_KEY,JSON.stringify([...rx].slice(-500)));}catch{/* storage blocked */}buzz(10);draw();
    if(rx.has(k))ul.querySelector(`.msg[data-id="${CSS.escape(b.dataset.id)}"] .rx`)?.classList.add('pop');});
  ops.addEventListener('click',e=>{const b=e.target.closest('.opener');if(!b)return;ta.value=b.textContent;ta.dispatchEvent(new Event('input'));ta.focus();});
  $('.dmBack').addEventListener('click',close);addEventListener('keydown',e=>{if(e.key==='Escape'&&open)close();});
  document.addEventListener('visibilitychange',()=>{if(open&&!document.hidden)poll();});
  return {load,openThread,close,ring,respond:(id,a)=>F.respondConnect(U(),id,a),get threads(){return list;},get friends(){return friends;},set myLook(l){myLook=l;},set onClose(f){onClose=f;},get openId(){return open?.id||null;}};}
