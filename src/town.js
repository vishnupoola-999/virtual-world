// Living map + Feed + Chat activity (design/living-map-feed). Signed-in (non-anonymous) users see other people's public agent cards
// (publicAgents, written by the life loop at ~1 km precision) and a Feed sheet from the proxy's GET /feed.
// The caller's own card (doc id === /feed myId) is skipped: their agent is already drawn as 'me'.
// Anonymous users, network errors and missing config all fail quietly: no others on the map, a calm Feed message.
import {displayName as dn} from './names.js';
import {friendsHtml,avatar,lookOf,fillAvatars} from './threads.js';
const PROJ='virtual-world-8ac82',FS_DB='default'; // same as firebase.js (kept here so this module has no CDN imports)
export const FEED_URL='https://virtual-world-ai.onrender.com/feed?n=30';
export const CONNECT_URL='https://virtual-world-ai.onrender.com/connect';
export const FAN_PX=40,SPREAD_PX=72,EDGE=16;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fromRest=v=>v==null?null:'stringValue' in v?v.stringValue:'doubleValue' in v?v.doubleValue:'integerValue' in v?Number(v.integerValue)
  :'booleanValue' in v?v.booleanValue:'timestampValue' in v?v.timestampValue:'mapValue' in v?Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,fromRest(x)]))
  :'arrayValue' in v?(v.arrayValue.values||[]).map(fromRest):null;
export const clip=(s,n=40)=>{s=String(s||'').replace(/\s+/g,' ').trim();return s.length>n?s.slice(0,n-1).trimEnd()+'…':s;};
// Public card status may be {kind,label} or a plain string. Labels are capped at 40 characters.
export function cardStatus(st){if(typeof st==='string')return st.trim()?{kind:'walking',label:clip(st)}:null;
  if(st&&typeof st==='object'&&st.label)return {...st,label:clip(st.label)};return null;}
// Agents sharing a spot fan out around it by 40px (72px once the group is tapped open). Returns Map id -> [dx,dy] in px.
export const spotKey=a=>a.lat.toFixed(3)+','+a.lon.toFixed(3);
export function groupsOf(list){const g=new Map();for(const a of list){const k=spotKey(a);(g.get(k)||g.set(k,[]).get(k)).push(a);}return g;}
export function fanOut(list,px=FAN_PX){const groups=new Map(),out=new Map();
  for(const a of list){const k=spotKey(a);(groups.get(k)||groups.set(k,[]).get(k)).push(a.id);}
  for(const ids of groups.values()){if(ids.length===1){out.set(ids[0],[0,0]);continue;}
    ids.forEach((id,i)=>{const t=-Math.PI/2+i*2*Math.PI/ids.length;out.set(id,[Math.round(Math.cos(t)*px),Math.round(Math.sin(t)*px*.5)]);});}
  return out;}
// Keep a box (a character on screen) EDGE px inside the viewport and 8px clear of the rail. Returns the x shift. Pure, unit tested.
export function clearShift(b,{w,rail}){let x=b.x;
  if(rail&&b.y<rail.y+rail.h+8&&b.y+b.h>rail.y-8&&x+b.w>rail.x-8)x=Math.min(x,rail.x-8-b.w);
  x=Math.min(x,w-EDGE-b.w);x=Math.max(x,EDGE);return x-b.x;}
const isReal=u=>!!(u&&!u.isAnonymous&&typeof u.getIdToken==='function');
// Pages past 100 with nextPageToken (capped at 20 pages = 2000 cards).
export async function fetchPublicAgents(user,fetchImpl=fetch){const t=await user.getIdToken();const out=[];let tok='';
  for(let i=0;i<20;i++){
    const r=await fetchImpl(`https://firestore.googleapis.com/v1/projects/${PROJ}/databases/${FS_DB}/documents/publicAgents?pageSize=100${tok?'&pageToken='+encodeURIComponent(tok):''}`,{headers:{Authorization:'Bearer '+t}});
    if(!r.ok)throw new Error('publicAgents '+r.status);const j=await r.json();
    for(const d of j.documents||[])out.push({id:d.name.split('/').pop(),...Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,fromRest(v)]))});
    tok=j.nextPageToken||'';if(!tok)break;}
  return out;}
export async function fetchFeed(user){const t=await user.getIdToken();const r=await fetch(FEED_URL,{headers:{Authorization:'Bearer '+t}});
  if(!r.ok)throw new Error('feed '+r.status);const j=await r.json();
  return {myId:typeof j.myId==='string'?j.myId:null,mine:Array.isArray(j.mine)?j.mine:[],town:Array.isArray(j.town)?j.town:[],
    nearby:Array.isArray(j.nearby)?j.nearby:[],incoming:Array.isArray(j.incoming)?j.incoming:[],outgoing:Array.isArray(j.outgoing)?j.outgoing:[]};}
// Say hi (PR #43 POST /connect). Resolves {id,createdAt}; throws an Error carrying .status on any failure (0 = offline).
export async function sendConnect(user,{toAgentId,meetId,text}){const t=await user.getIdToken();let r;
  try{r=await fetch(CONNECT_URL,{method:'POST',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},body:JSON.stringify({toAgentId,meetId,text:String(text).trim()})});}
  catch{const e=new Error('offline');e.status=0;throw e;}
  if(r.status===201)return r.json().catch(()=>({}));const e=new Error('connect '+r.status);e.status=r.status;throw e;}
export const HI_MAX=200;
const ERRS={0:'You seem offline. Try again in a moment.',400:'That message can\'t be sent. Keep it simple, no links or contact details.',401:'Please sign in again to say hi.',
  403:'You can\'t send a hi to this agent.',404:'We couldn\'t find this meet anymore.',409:'You already said hi',429:'Try again later',503:'Say hi is resting. Try again later.'};
export const connectError=st=>ERRS[st]||'Something went wrong. Try again.';
export const hiDraft=name=>{const n=clip(String(name||'').trim(),40)||'there';return `Hi ${n}, our agents had a lovely chat and think we'd get along. Would love to connect.`;};
const ago=at=>{const m=Math.max(0,Math.round((Date.now()-(typeof at==='number'?at:Date.parse(at)||0))/60000));return m<1?'Just now':m<60?m+' min ago':m<1440?Math.round(m/60)+' h ago':Math.round(m/1440)+' d ago';};
function meetRow(e){const who=esc(dn(e.withName)||'another agent');
  const sh=(e.shared||[]).slice(0,3).map(esc);const lines=(e.lines||[]).slice(0,6);
  const chips=sh.length?`<span class="fdChips in" aria-label="Shared interests">${sh.slice(0,2).map(t=>`<span>${t}</span>`).join('')}</span>`:'';
  const body=lines.map(l=>`<p><b>${esc(dn(l.speaker))}</b> ${esc(l.text)}</p>`).join('')||`<p>${sh.length?`You both like ${esc(andList(e.shared.slice(0,3)))}.`:'Said hello and swapped notes.'}</p>`;
  return `<li class="fd meet"><button type="button" class="fdHead" aria-expanded="false"><span class="fdDot"></span><span class="fdT">Met ${who}</span>${chips}<small>${ago(e.at)}</small></button><div class="fdBody">${body}</div></li>`;}
const diaryRow=e=>`<li class="fd"><div class="fdHead"><span class="fdDot dim"></span><span class="fdT">${esc(clip(e.text,120))}</span><small>${ago(e.at)}</small></div></li>`;
export const EMPTY='Nothing yet. Bs is out exploring.';
// Feed sheet (Vishnu): only meets your own agent was part of, in its voice ("Met Dad"). Meets between other agents are never listed.
export function myMeets(f){const me=f.myId,own=(f.mine||[]).filter(e=>e&&e.kind==='meet');const seen=new Set(own.map(e=>e.withId).filter(Boolean));
  const pub=me?(f.town||[]).filter(e=>e&&(e.aId===me||e.bId===me)).map(e=>{const a=e.aId===me;return {id:e.id,withId:a?e.bId:e.aId,withName:a?e.bName:e.aName,shared:e.shared,at:e.at};}).filter(e=>!seen.has(e.withId)):[];
  return byNewest([...own,...pub]);}
export function feedHtml(f){const m=myMeets(f);
  return m.length?`<ul class="stag">${m.map(meetRow).join('')}</ul>`:`<p class="fdEmpty">No meets yet. Your agent will say hello around town soon.</p>`;}
// Agent chats: the agent's own log (one line each, a short gist on expand) and "Worth meeting" notes.
const andList=a=>a.length<2?(a[0]||''):a.slice(0,-1).join(', ')+' and '+a[a.length-1];
// Worth-meeting copy: the backend `note` (PR #42) when present, escaped and capped at 90; otherwise one plain line.
export function noteText(e){if(typeof e.note==='string'&&e.note.trim())return esc(clip(e.note,90));
  const sh=(e.shared||[]).filter(x=>typeof x==='string'&&x.trim()).slice(0,2);if(!sh.length)return '';
  const n=esc(dn(e.withName)||'someone new');return `Met ${n}, you both like ${esc(sh.join(' and '))}.`;}
export const worthMeeting=f=>(f.mine||[]).filter(e=>e.kind==='meet'&&!e.town&&Array.isArray(e.shared)&&e.shared.length);
const gist=e=>{const sh=(e.shared||[]).slice(0,3);const l=(e.lines||[]).find(x=>x&&x.text);
  return (sh.length?`Talked about ${esc(andList(sh))}.`:'Said hello and swapped notes.')+(l?` <span class="q">"${esc(clip(l.text,80))}"</span>`:'');};
// A decline is never shown to the sender: their card stays at "Request sent".
const pendingTo=f=>new Set((f.outgoing||[]).filter(o=>o&&(o.status==='pending'||o.status==='declined')&&o.toAgentId).map(o=>o.toAgentId));
export const connectedTo=f=>{const m=new Map();for(const o of f.outgoing||[])if(o&&o.status==='accepted'&&o.toAgentId&&o.threadId)m.set(o.toAgentId,o.threadId);return m;};
const openBtn=tid=>`<div class="sentRow conn"><button type="button" class="openChat" data-thread="${esc(tid)}">Connected · Open chat</button></div>`;
const sentTag='<span class="sentTag">Hi sent · pending</span>';
const logRow=(e,p)=>e.kind==='meet'?`<li class="fd meet"><button type="button" class="fdHead" aria-expanded="false"><span class="fdDot"></span><span class="fdT">Met ${esc(dn(e.withName)||'another agent')}</span>${p&&p.has(e.withId)?sentTag:''}<small>${ago(e.at)}</small></button><div class="fdBody"><p>${gist(e)}</p></div></li>`:diaryRow(e);
const atMs=e=>typeof e.at==='number'?e.at:Date.parse(e.at)||0;
// Log order: newest first by timestamp (the /feed list can arrive mixed).
export const byNewest=list=>[...list].sort((a,b)=>atMs(b)-atMs(a));
const X='<button type="button" class="later x" aria-label="Dismiss"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';
// Incoming hi requests (pending only; no accept yet, so a dismiss is the only action).
// Requests: Accept/Decline only while pending; accepted shows Open chat; declined disappears.
export const incomingOf=(f,dismissed=new Set())=>(f.incoming||[]).filter(r=>r&&r.id&&!dismissed.has(r.id)&&r.status!=='declined');
const incCard=(r,lk)=>`<li class="wm inc" data-id="${esc(r.id)}" data-kind="in">${r.status==='accepted'?'':X}<div class="incH">${avatar(lk(r))}<p class="incT"><b>${esc(clip(dn(r.fromName)||'Someone',40))}</b> wants to connect</p></div>${String(r.text||'').trim()?`<p class="incQ">${esc(clip(r.text,HI_MAX))}</p>`:''}<small class="incAgo">${ago(r.createdAt)}</small>`
  +(r.status==='accepted'&&r.threadId?openBtn(r.threadId):`<div class="acts"><button type="button" class="decline">Decline</button><button type="button" class="accept">Accept</button></div><small class="err" role="alert"></small>`)+'</li>';
const wmCard=(e,p,c=new Map())=>c.has(e.withId)?`<li class="wm conn" data-id="${esc(e.id)}" data-with="${esc(e.withId||'')}">${X}<p>${noteText(e)}</p><div class="fdChips">${(e.shared||[]).slice(0,3).map(t=>`<span>${esc(t)}</span>`).join('')}</div>${openBtn(c.get(e.withId))}</li>`:`<li class="wm${p.has(e.withId)?' sent':''}" data-id="${esc(e.id)}" data-with="${esc(e.withId||'')}">${X}<p>${noteText(e)}</p><div class="fdChips">${(e.shared||[]).slice(0,3).map(t=>`<span>${esc(t)}</span>`).join('')}</div>`
  +(p.has(e.withId)?`<div class="sentRow" role="status"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>Request sent</div>`
  :`<div class="acts"><button type="button" class="hi" data-name="${esc(dn(e.withName))}">Say hi</button></div>`)+'</li>';
export function activityHtml(f,{dismissed=new Set(),inDismissed=new Set(),threads=[],lookFor=r=>lookOf(null,r.fromName)}={}){const mine=byNewest(f.mine||[]),p=pendingTo(f),c=connectedTo(f);
  const inc=incomingOf(f,inDismissed).filter(r=>r.status!=='accepted'||!threads.some(t=>t.id===r.threadId));
  const ih=friendsHtml(threads)+(inc.length?`<div class="wmSec inSec"><div class="fdSec">Requests</div><ul>${inc.map(r=>incCard(r,lookFor)).join('')}</ul></div>`:'');
  if(!mine.length)return ih+(ih?'':`<p class="fdEmpty">${EMPTY}</p>`);
  const wm=worthMeeting(f).filter(e=>!dismissed.has(e.id));
  const hl=wm.length?`<div class="wmSec"><div class="fdSec">Worth meeting</div><ul>${wm.map(e=>wmCard(e,p,c)).join('')}</ul></div>`:'';
  return ih+hl+`<div class="fdSec">Log</div><ul class="stag">${mine.map(e=>logRow(e,p)).join('')}</ul>`;}
export const SKELETON=`<ul class="fdSk" aria-hidden="true"><li></li><li></li><li></li></ul>`;
export const ACT_SKELETON=`<div class="fdSec">Log</div><ul class="fdSk" aria-hidden="true"><li></li><li></li><li></li></ul>`;
const store=k=>{try{return new Set(JSON.parse(localStorage.getItem(k)||'[]'));}catch{return new Set();}};
const save=(k,v)=>{try{localStorage.setItem(k,JSON.stringify([...v].slice(-200)));}catch{/* storage blocked */}};
const toggleMeet=e=>{const h=e.target.closest('.meet>.fdHead');if(!h)return;const li=h.parentElement,on=!li.classList.contains('open');li.classList.toggle('open',on);h.setAttribute('aria-expanded',String(on));};

export function setupTown({agents,living,getUser,el,actEl,dotEl,map,threads=null,deps={}}){const F={fetchPublicAgents,fetchFeed,sendConnect,...deps};let cur=null,cu=null;let myId=null,drawn=new Set(),seq=0,aseq=0,last=[];const spread=new Set();
  // One /feed request serves the map (myId), the Feed sheet and Agent chats; reused for 30 s.
  let fc=null;const feed=u=>{if(fc&&fc.u===u&&Date.now()-fc.t<30000)return fc.p;const p=F.fetchFeed(u);fc={u,t:Date.now(),p};p.catch(()=>{if(fc?.p===p)fc=null;});return p;};
  async function ensureMyId(u){try{const f=await feed(u);myId=f.myId||myId;townExtras(f);}catch{/* feed down: still draw others */}return myId;}
  // PR #45 (optional): meet partners for town meets and nearby[] town characters. Characters only, no pills. Absent fields: no-op.
  let nb=new Set();function townExtras(f){living.setPartners?.((f.mine||[]).map(e=>e&&e.partner).filter(Boolean));
    const me=agents.get('me'),now=new Set();
    for(const p of Array.isArray(f.nearby)?f.nearby.slice(0,6):[]){if(!p||!p.id)continue;let lat=+p.lat,lon=+(p.lng??p.lon);
      if(!(Number.isFinite(lat)&&Number.isFinite(lon))&&me&&p.offsetM){lon=me.lon+(+p.offsetM.east||0)/(111320*Math.cos(me.lat*Math.PI/180));lat=me.lat+(+p.offsetM.north||0)/110540;}
      if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;const id='nb-'+p.id,ci=p.look?.colorIndex;now.add(id);
      agents.put({id,name:dn(p.name)||'Neighbour',lat,lon,look:Number.isInteger(ci)&&living.townLook?living.townLook(p.look):undefined,ownerName:dn(p.name),other:true,meta:'Neighbour'});agents.get(id)?.el.classList.add('town','nearby');}
    for(const id of nb)if(!now.has(id))agents.remove(id);nb=now;}
  function draw(list){last=list;const keep=list.filter(d=>d&&d.id&&d.id!==myId&&Number.isFinite(d.lat)&&Number.isFinite(d.lon));const now=new Set();
    const off=new Map(),group=new Map();
    for(const [k,g] of groupsOf(keep)){const o=fanOut(g,spread.has(k)?SPREAD_PX:FAN_PX);for(const a of g){off.set(a.id,o.get(a.id));group.set(a.id,g.length>1&&!spread.has(k)?k:null);}}
    for(const d of keep){const st=cardStatus(d.status);now.add(d.id);
      living.putOther?living.putOther({id:d.id,name:d.name||'Agent',lat:d.lat,lon:d.lon,look:d.look,approx:{lat:d.lat,lon:d.lon},status:st||undefined,other:true,meta:'Around town · approximate area'})
        :agents.put({id:d.id,name:d.name||'Agent',lat:d.lat,lon:d.lon,look:d.look,other:true});
      const a=agents.get(d.id);if(!a)continue;a.marker.setOffset([off.get(d.id)[0],-6+off.get(d.id)[1]]);a.townGroup=group.get(d.id);hookTap(a);}
    for(const id of drawn)if(!now.has(id))agents.remove(id);drawn=now;threads?.ring();queueClear();return keep.length;}
  // Tapping an agent in a closed group zooms in and spreads the group instead of opening a profile.
  function hookTap(a){const e=a.el;if(!e||e.dataset.town)return;e.dataset.town='1';
    e.addEventListener('click',ev=>{if(!a.townGroup)return;ev.stopImmediatePropagation();ev.preventDefault();expand(a.townGroup,a.marker.getLngLat());},true);}
  function expand(k,ll){spread.add(k);map?.easeTo({center:ll,zoom:Math.max(map.getZoom()+1.5,19),duration:REDUCE()?0:400,essential:true});draw(last);}
  const REDUCE=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Screen-space pass: other people's characters are nudged (CSS translate, composes with MapLibre's transform) clear of the rail and edges.
  let qd=0;function queueClear(){if(qd||typeof requestAnimationFrame!=='function')return;qd=requestAnimationFrame(()=>{qd=0;keepClear();});}
  function keepClear(){if(typeof document==='undefined')return;const W=innerWidth,H=innerHeight,rr=document.getElementById('rail')?.getBoundingClientRect();
    const rail=rr&&rr.width?{x:rr.left,y:rr.top,w:rr.width,h:rr.height}:null;
    for(const e of document.querySelectorAll('.maplibregl-marker.ag.other')){e.style.translate='';const cv=e.querySelector('canvas');const r=(cv||e).getBoundingClientRect();
      if(!r.width||r.right<0||r.left>W||r.bottom<0||r.top>H)continue;const dx=clearShift({x:r.left,y:r.top,w:r.width,h:r.height},{w:W,rail});if(dx)e.style.translate=dx+'px 0';}}
  if(map){setInterval(()=>{if(!document.hidden&&document.body.dataset.tab!=='chat')queueClear();},1000);map.on('moveend',queueClear);map.on('zoomend',queueClear);addEventListener('resize',queueClear);}
  async function refreshMap(user=getUser()){if(!isReal(user)){clearMap();return 0;}
    try{await ensureMyId(user);return draw(await F.fetchPublicAgents(user));}catch(e){console.warn('town',e?.message);return 0;}}
  function clearMap(){for(const id of drawn)agents.remove(id);for(const id of nb)agents.remove(id);nb=new Set();drawn=new Set();myId=null;}
  async function loadFeed(user=getUser()){if(!el)return;const n=++seq;el.innerHTML=SKELETON;el.setAttribute('aria-busy','true');
    if(!isReal(user)){el.innerHTML='<p class="fdEmpty">Sign in to see what your agent and others have been up to.</p>';el.removeAttribute('aria-busy');return;}
    try{const f=await feed(user);if(n!==seq)return;if(f.myId)myId=f.myId;el.innerHTML=feedHtml(f);}
    catch(e){if(n!==seq)return;console.warn('feed',e?.message);el.innerHTML='<p class="fdEmpty">Feed is resting. Try again in a minute.</p>';}
    el.removeAttribute('aria-busy');}
  async function loadActivity(user=getUser()){if(!actEl)return;const n=++aseq;actEl.innerHTML=ACT_SKELETON;actEl.setAttribute('aria-busy','true');
    if(!isReal(user)){actEl.innerHTML='<p class="fdEmpty">Sign in to see what your agent has been up to.</p>';actEl.removeAttribute('aria-busy');return;}
    try{const [f]=await Promise.all([feed(user),threads?.load(user)]);if(n!==aseq)return;if(f.myId)myId=f.myId;cur=f;cu=user;render();
      const seen=store('vw-wm-seen');for(const e of worthMeeting(f))seen.add(e.id);save('vw-wm-seen',seen);const is=store('vw-in-seen');for(const r of f.incoming||[])if(r?.id)is.add(r.id);save('vw-in-seen',is);if(dotEl)dotEl.hidden=true;}
    catch(e){if(n!==aseq)return;console.warn('activity',e?.message);actEl.innerHTML='<p class="fdEmpty">Activity is resting. Try again in a minute.</p>';}
    actEl.removeAttribute('aria-busy');}
  const lookFor=r=>lookOf(agents.get(r.fromAgentId)?.look||null,r.fromName);
  const render=()=>{if(cur&&actEl){actEl.innerHTML=activityHtml(cur,{dismissed:store('vw-wm-done'),inDismissed:store('vw-in-done'),threads:threads?.threads||[],lookFor});fillAvatars(actEl);}};
  // Accept opens the private chat straight away; Decline just removes the card (the sender never sees it).
  async function respond(li,action){const id=li.dataset.id,err=li.querySelector('.err'),bs=li.querySelectorAll('.acts button');for(const b of bs)b.disabled=true;li.setAttribute('aria-busy','true');if(err)err.textContent='';
    try{const r=await threads.respond(id,action);fc=null;
      cur={...cur,incoming:(cur.incoming||[]).map(x=>x.id===id?{...x,status:r.status||(action==='accept'?'accepted':'declined'),...(r.threadId?{threadId:r.threadId}:{})}:x)};
      if(r.threadId){await threads.load();render();await threads.openThread(r.threadId);}else render();}
    catch(x){for(const b of bs)b.disabled=false;li.removeAttribute('aria-busy');if(err)err.textContent=x?.status===404?'This request is no longer available.':x?.status===409?'Already answered.':'Something went wrong. Try again.';
      if(x?.status===409||x?.status===404){fc=null;setTimeout(()=>loadActivity(),1200);}}}
  if(threads)threads.onClose=()=>{if(actEl?.isConnected)threads.load().then(render);};
  // Unread dot on the Agent chats rail button: worth-meeting notes and incoming hi requests not opened yet.
  async function checkUnread(user=getUser()){if(!dotEl||!isReal(user))return 0;try{const f=await feed(user),seen=store('vw-wm-seen'),is=store('vw-in-seen');
    const n=worthMeeting(f).filter(e=>!seen.has(e.id)).length+(f.incoming||[]).filter(r=>r?.id&&!is.has(r.id)).length;dotEl.hidden=!n;return n;}catch{return 0;}}
  el?.addEventListener('click',toggleMeet);
  // Say hi: an inline composer (prefilled, editable, 200 max) that POSTs /connect only when Send is tapped.
  function openComposer(li,name){if(li.querySelector('.cmp'))return;const acts=li.querySelector('.acts');const c=document.createElement('div');c.className='cmp';
    c.innerHTML=`<textarea class="draft" rows="3" maxlength="${HI_MAX}" aria-label="Your hi"></textarea><div class="cmpMeta"><small class="err" role="alert"></small><small class="cnt" aria-live="polite"></small></div><div class="acts"><button type="button" class="cancel">Cancel</button><button type="button" class="send">Send</button></div>`;
    const t=c.querySelector('textarea');t.value=hiDraft(name);acts.replaceWith(c);sync(c);t.oninput=()=>sync(c);t.focus({preventScroll:true});}
  function sync(c){const t=c.querySelector('textarea'),n=t.value.trim().length;c.querySelector('.cnt').textContent=`${t.value.length}/${HI_MAX}`;c.querySelector('.send').disabled=!n||n>HI_MAX||c.classList.contains('busy');}
  async function send(li){const c=li.querySelector('.cmp'),t=c.querySelector('textarea'),err=c.querySelector('.err'),u=cu||getUser();const e=(cur?.mine||[]).find(x=>String(x.id)===li.dataset.id);
    if(!e||!isReal(u)){err.textContent=connectError(e?401:404);return;}
    c.classList.add('busy');t.disabled=true;c.querySelector('.cancel').disabled=true;const sb=c.querySelector('.send');sb.disabled=true;sb.textContent='Sending…';err.textContent='';li.setAttribute('aria-busy','true');
    try{const r=await F.sendConnect(u,{toAgentId:e.withId,meetId:e.id,text:t.value});
      cur={...cur,outgoing:[{id:r?.id||'local',toAgentId:e.withId,createdAt:r?.createdAt||Date.now(),status:'pending'},...(cur.outgoing||[])]};fc=null;render();}
    catch(x){if(x?.status===409){cur={...cur,outgoing:[{id:'dup',toAgentId:e.withId,createdAt:Date.now(),status:'pending'},...(cur.outgoing||[])]};}
      c.classList.remove('busy');t.disabled=false;c.querySelector('.cancel').disabled=false;sb.textContent='Send';err.textContent=connectError(x?.status);sync(c);li.removeAttribute('aria-busy');}}
  actEl?.addEventListener('click',ev=>{const o=ev.target.closest('.openChat,.frBtn');if(o&&threads)return threads.openThread(o.dataset.thread||o.closest('.fr').dataset.thread);
    const b=ev.target.closest('.wm button');if(!b)return toggleMeet(ev);const li=b.closest('.wm'),id=li.dataset.id;
    if(b.classList.contains('accept'))return respond(li,'accept');
    if(b.classList.contains('decline'))return respond(li,'decline');
    if(b.classList.contains('hi'))return openComposer(li,b.dataset.name);
    if(b.classList.contains('send'))return send(li);
    if(b.classList.contains('cancel')){const a=document.createElement('div');a.className='acts';a.innerHTML=`<button type="button" class="hi"></button>`;a.firstChild.dataset.name=b.closest('.wm').querySelector('.hi')?.dataset.name||((cur?.mine||[]).find(x=>String(x.id)===id)?.withName||'');a.firstChild.textContent='Say hi';li.querySelector('.cmp').replaceWith(a);return;}
    const sec=li.closest('.wmSec');li.remove();if(sec&&!sec.querySelector('.wm'))sec.remove();
    const k=li.dataset.kind==='in'?'vw-in-done':'vw-wm-done';const d=store(k);d.add(id);save(k,d);});
  const fresh=()=>{fc=null;};
  return {refreshMap,clearMap,loadFeed,loadActivity,checkUnread,fresh,draw,keepClear,expand,get myId(){return myId;},set myId(v){myId=v;}};}
