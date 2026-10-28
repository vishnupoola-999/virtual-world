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
export const fetchMessages=(u,id,after)=>call(u,`/threads/${encodeURIComponent(id)}/messages`+(after?`?after=${after}`:'')).then(j=>({messages:Array.isArray(j.messages)?j.messages:[],more:!!j.more}));
export const postMessage=(u,id,text)=>call(u,`/threads/${encodeURIComponent(id)}/messages`,{method:'POST',body:{text}});
// A null or old look falls back to a deterministic default creature from the name.
export const lookOf=(look,name)=>toLook(look||null,name||'');
export const BLOCKED='Links and contact details can\'t be shared here yet.',SLOW='Slow down a little, try again in a minute';
export function sendError(x){if(x?.status===400&&/not allowed/i.test(x.error||''))return BLOCKED;if(x?.status===429)return SLOW;if(x?.status===400)return 'That message is too long.';return 'Couldn\'t send. Try again.';}
export function checkText(s){const t=String(s||'');if(!t.trim())return 'empty';if(t.length>TEXT_MAX)return 'That message is too long.';if(t.split('\n').length>LINES_MAX)return 'Too many lines.';return '';}
// Merge newly polled messages (oldest first), deduped by id.
export function mergeMsgs(old,add){const m=new Map(old.map(x=>[x.id,x]));for(const x of add||[])if(x&&x.id)m.set(x.id,x);return [...m.values()].sort((a,b)=>(+a.at||0)-(+b.at||0));}
export const lastAt=list=>list.length?Math.max(...list.map(x=>+x.at||0)):0;
export function avatar(look,cls='cav'){const l=lookOf(look);return `<span class="${cls}" style="--c:${l.color||CREATURE_COLOURS[l.creature]}" data-cr="${l.creature}"><img alt=""></span>`;}
export const interestsOf=w=>(Array.isArray(w?.interests)?w.interests:[]).filter(x=>typeof x==='string').slice(0,3);
const tm=at=>{const d=new Date(+at||0);return d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0');};
export function friendsHtml(threads){if(!threads?.length)return '';
  return `<div class="wmSec frSec"><div class="fdSec">Chats</div><ul>${threads.map(t=>{const w=t.with||{},look=lookOf(w.look,w.name),ints=interestsOf(w),l=t.last;
    return `<li class="fr" data-thread="${esc(t.id)}"><button type="button" class="frBtn">${avatar(look)}<span class="frMain"><b>${esc(w.name||'Friend')}</b><small>${l&&l.text?esc((l.from==='me'?'You: ':'')+String(l.text).slice(0,60)):esc(ints.join(' · '))}</small></span>${t.unread?`<span class="frUn">${Math.min(+t.unread,99)}</span>`:''}</button></li>`;}).join('')}</ul></div>`;}
export function msgHtml(m,meLook,themLook){if(m.from==='system')return `<li class="sys" data-id="${esc(m.id)}">${avatar(meLook,'cav sm')}<span>${esc(m.text)}</span>${avatar(themLook,'cav sm')}</li>`;
  return `<li class="msg ${m.from==='me'?'me':'them'}" data-id="${esc(m.id)}"><p>${esc(m.text)}</p><small>${tm(m.at)}</small></li>`;}
// Fill creature thumbnails lazily (three.js stays off the startup path); the coloured circle shows until then.
export function fillAvatars(root){const els=root?.querySelectorAll?.('.cav img:not([src])');if(!els?.length)return;
  import('./cards3d.js').then(m=>{const t=m.cardThumbs();for(const i of els){const c=i.parentElement.dataset.cr;if(t[c])i.src=t[c];}}).catch(()=>{});}

export function setupThreads({getUser,agents,deps={}}){const F={fetchThreads,fetchMessages,postMessage,respondConnect,...deps};
  let u0=null;const U=()=>{const g=getUser();return g&&!g.isAnonymous?g:(u0||g);};
  let list=[],myLook=null,open=null,timer=0,msgs=[],cool=0;const friends=new Set();
  const v=document.createElement('section');v.id='dmView';v.hidden=true;v.setAttribute('role','dialog');v.setAttribute('aria-label','Chat');
  v.innerHTML=`<header class="dmHead"><button type="button" class="dmBack" aria-label="Back"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button><span class="dmPair"></span><span class="dmWho"><b></b><small></small></span></header><ul class="dmList" aria-live="polite"></ul><form class="dmForm"><small class="dmNote" role="status"></small><div class="dmRow"><textarea rows="1" maxlength="${TEXT_MAX}" aria-label="Message" placeholder="Message"></textarea><button type="submit" class="dmSend" aria-label="Send"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg></button></div></form>`;
  document.body.appendChild(v);const $=s=>v.querySelector(s),ta=$('textarea'),note=$('.dmNote'),sb=$('.dmSend'),ul=$('.dmList');
  const meLook=()=>myLook||agents?.get('me')?.look||null;
  function ring(){for(const id of friends)agents?.get(id)?.el?.classList.add('friend');}
  async function load(u){if(u)u0=u;u=U();try{const r=await F.fetchThreads(u);list=r.threads;friends.clear();for(const t of list)if(t.with?.id)friends.add(t.with.id);ring();}catch(e){console.warn('threads',e?.message);}return list;}
  function draw(){const t=open,w=t.with||{},tl=lookOf(w.look,w.name),ml=meLook();ul.innerHTML=msgs.map(m=>msgHtml(m,ml,tl)).join('');fillAvatars(ul);ul.scrollTop=ul.scrollHeight;}
  async function poll(){clearTimeout(timer);if(!open)return;const id=open.id;
    try{const r=await F.fetchMessages(U(),id,lastAt(msgs)||undefined);if(open?.id!==id)return;const n=msgs.length;msgs=mergeMsgs(msgs,r.messages);if(msgs.length!==n)draw();}catch(e){console.warn('messages',e?.message);}
    if(open?.id===id)timer=setTimeout(poll,document.hidden?POLL_HIDDEN_MS:POLL_MS);}
  async function openThread(id,known){let t=known||list.find(x=>x.id===id);if(!t){await load();t=list.find(x=>x.id===id)||{id,with:{}};}
    open=t;msgs=[];const w=t.with||{};$('.dmPair').innerHTML=avatar(meLook())+avatar(lookOf(w.look,w.name));fillAvatars($('.dmPair'));
    $('.dmWho b').textContent=w.name||'Friend';$('.dmWho small').textContent=interestsOf(w).join(' · ');note.textContent='';ul.innerHTML='';v.hidden=false;document.body.classList.add('dmOpen');
    requestAnimationFrame(()=>v.classList.add('on'));sync();await poll();return t;}
  function close(){open=null;clearTimeout(timer);v.classList.remove('on');v.hidden=true;document.body.classList.remove('dmOpen');onClose?.();}
  let onClose=null;
  function sync(){const e=checkText(ta.value);sb.disabled=!!e||Date.now()<cool;v.classList.toggle('cool',Date.now()<cool);}
  ta.addEventListener('input',()=>{if(note.dataset.k==='blocked'){note.textContent='';note.dataset.k='';}const e=checkText(ta.value);if(e&&e!=='empty'){note.textContent=e;note.dataset.k='len';}else if(note.dataset.k==='len'){note.textContent='';note.dataset.k='';}sync();});
  ta.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!matchMedia('(pointer:coarse)').matches){e.preventDefault();$('.dmForm').requestSubmit();}});
  $('.dmForm').addEventListener('submit',async e=>{e.preventDefault();if(!open||sb.disabled)return;const text=ta.value,id=open.id;sb.disabled=true;
    try{await F.postMessage(U(),id,text);ta.value='';note.textContent='';note.dataset.k='';await poll();}
    catch(x){note.textContent=sendError(x);note.dataset.k=x?.status===429?'slow':'blocked';// never clear what they typed
      if(x?.status===429){cool=Date.now()+60000;setTimeout(()=>{if(note.dataset.k==='slow'){note.textContent='';note.dataset.k='';}sync();},60000);}}
    sync();});
  $('.dmBack').addEventListener('click',close);addEventListener('keydown',e=>{if(e.key==='Escape'&&open)close();});
  document.addEventListener('visibilitychange',()=>{if(open&&!document.hidden)poll();});
  return {load,openThread,close,ring,respond:(id,a)=>F.respondConnect(U(),id,a),get threads(){return list;},get friends(){return friends;},set myLook(l){myLook=l;},set onClose(f){onClose=f;},get openId(){return open?.id||null;}};}
