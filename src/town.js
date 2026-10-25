// Living map + Feed + Chat activity (design/living-map-feed). Signed-in (non-anonymous) users see other people's public agent cards
// (publicAgents, written by the life loop at ~1 km precision) and a Feed sheet from the proxy's GET /feed.
// The caller's own card (doc id === /feed myId) is skipped: their agent is already drawn as 'me'.
// Anonymous users, network errors and missing config all fail quietly: no others on the map, a calm Feed message.
const PROJ='virtual-world-8ac82',FS_DB='default'; // same as firebase.js (kept here so this module has no CDN imports)
export const FEED_URL='https://virtual-world-ai.onrender.com/feed?n=30';
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
export async function fetchPublicAgents(user){const t=await user.getIdToken();
  const r=await fetch(`https://firestore.googleapis.com/v1/projects/${PROJ}/databases/${FS_DB}/documents/publicAgents?pageSize=100`,{headers:{Authorization:'Bearer '+t}});
  if(!r.ok)throw new Error('publicAgents '+r.status);const j=await r.json();
  return (j.documents||[]).map(d=>({id:d.name.split('/').pop(),...Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,fromRest(v)]))}));}
export async function fetchFeed(user){const t=await user.getIdToken();const r=await fetch(FEED_URL,{headers:{Authorization:'Bearer '+t}});
  if(!r.ok)throw new Error('feed '+r.status);const j=await r.json();
  return {myId:typeof j.myId==='string'?j.myId:null,mine:Array.isArray(j.mine)?j.mine:[],town:Array.isArray(j.town)?j.town:[]};}
const ago=at=>{const m=Math.max(0,Math.round((Date.now()-(typeof at==='number'?at:Date.parse(at)||0))/60000));return m<1?'Just now':m<60?m+' min ago':m<1440?Math.round(m/60)+' h ago':Math.round(m/1440)+' d ago';};
function meetRow(e,mine){const who=mine?esc(e.withName||'another agent'):`${esc(e.aName||'Someone')} and ${esc(e.bName||'someone')}`;
  const sh=(e.shared||[]).slice(0,3).map(esc);const lines=(e.lines||[]).slice(0,6);
  const body=(sh.length?`<div class="fdChips" aria-label="Shared interests">${sh.map(t=>`<span>${t}</span>`).join('')}</div>`:'')+lines.map(l=>`<p><b>${esc(l.speaker)}</b> ${esc(l.text)}</p>`).join('');
  return `<li class="fd meet"><button type="button" class="fdHead" aria-expanded="false"><span class="fdDot"></span><span class="fdT">${mine?'Met '+who:who+' met'}</span><small>${ago(e.at)}</small></button>${body?`<div class="fdBody">${body}</div>`:''}</li>`;}
const diaryRow=e=>`<li class="fd"><div class="fdHead"><span class="fdDot dim"></span><span class="fdT">${esc(clip(e.text,120))}</span><small>${ago(e.at)}</small></div></li>`;
export const EMPTY='Nothing yet. Bs is out exploring.';
// Feed sheet: public "Around town" meets only. Your own agent's history lives in Agent chats, so nothing shows twice.
export function feedHtml(f){const town=(f.town||[]);
  return `<div class="fdSec">Around town</div>`+(town.length?`<ul>${town.map(e=>meetRow(e,false)).join('')}</ul>`:`<p class="fdEmpty">No meets around town yet.</p>`);}
// Agent chats: the agent's own log (one line each, a short gist on expand) and "Worth meeting" notes.
const andList=a=>a.length<2?(a[0]||''):a.slice(0,-1).join(', ')+' and '+a[a.length-1];
// Worth-meeting copy: the backend `note` (PR #42) when present, escaped and capped at 90; otherwise one plain line.
export function noteText(e){if(typeof e.note==='string'&&e.note.trim())return esc(clip(e.note,90));
  const sh=(e.shared||[]).filter(x=>typeof x==='string'&&x.trim()).slice(0,2);if(!sh.length)return '';
  const n=esc(String(e.withName||'').trim()||'someone new');return `Met ${n}, you both like ${esc(sh.join(' and '))}.`;}
export const worthMeeting=f=>(f.mine||[]).filter(e=>e.kind==='meet'&&!e.town&&Array.isArray(e.shared)&&e.shared.length);
const gist=e=>{const sh=(e.shared||[]).slice(0,3);const l=(e.lines||[]).find(x=>x&&x.text);
  return (sh.length?`Talked about ${esc(andList(sh))}.`:'Said hello and swapped notes.')+(l?` <span class="q">"${esc(clip(l.text,80))}"</span>`:'');};
const logRow=e=>e.kind==='meet'?`<li class="fd meet"><button type="button" class="fdHead" aria-expanded="false"><span class="fdDot"></span><span class="fdT">Met ${esc(e.withName||'another agent')}</span><small>${ago(e.at)}</small></button><div class="fdBody"><p>${gist(e)}</p></div></li>`:diaryRow(e);
export function activityHtml(f,{dismissed=new Set()}={}){const mine=(f.mine||[]);if(!mine.length)return `<p class="fdEmpty">${EMPTY}</p>`;
  const wm=worthMeeting(f).filter(e=>!dismissed.has(e.id));
  const hl=wm.length?`<div class="wmSec"><div class="fdSec">Worth meeting</div><ul>${wm.map(e=>`<li class="wm" data-id="${esc(e.id)}"><p>${noteText(e)}</p><div class="fdChips">${(e.shared||[]).slice(0,3).map(t=>`<span>${esc(t)}</span>`).join('')}</div><div class="acts"><button type="button" class="hi" data-name="${esc(e.withName||'')}">Say hi</button><button type="button" class="later">Maybe later</button></div></li>`).join('')}</ul></div>`:'';
  return hl+`<div class="fdSec">Log</div><ul>${mine.map(logRow).join('')}</ul>`;}
export const SKELETON=`<div class="fdSec">Around town</div><ul class="fdSk" aria-hidden="true"><li></li><li></li><li></li></ul>`;
export const ACT_SKELETON=`<div class="fdSec">Log</div><ul class="fdSk" aria-hidden="true"><li></li><li></li><li></li></ul>`;
const store=k=>{try{return new Set(JSON.parse(localStorage.getItem(k)||'[]'));}catch{return new Set();}};
const save=(k,v)=>{try{localStorage.setItem(k,JSON.stringify([...v].slice(-200)));}catch{/* storage blocked */}};
const toggleMeet=e=>{const h=e.target.closest('.meet>.fdHead');if(!h)return;const li=h.parentElement,on=!li.classList.contains('open');li.classList.toggle('open',on);h.setAttribute('aria-expanded',String(on));};

export function setupTown({agents,living,getUser,el,actEl,dotEl,map,deps={}}){const F={fetchPublicAgents,fetchFeed,...deps};let myId=null,drawn=new Set(),seq=0,aseq=0,last=[];const spread=new Set();
  // One /feed request serves the map (myId), the Feed sheet and Agent chats; reused for 30 s.
  let fc=null;const feed=u=>{if(fc&&fc.u===u&&Date.now()-fc.t<30000)return fc.p;const p=F.fetchFeed(u);fc={u,t:Date.now(),p};p.catch(()=>{if(fc?.p===p)fc=null;});return p;};
  async function ensureMyId(u){if(myId)return myId;try{myId=(await feed(u)).myId;}catch{/* feed down: still draw others */}return myId;}
  function draw(list){last=list;const keep=list.filter(d=>d&&d.id&&d.id!==myId&&Number.isFinite(d.lat)&&Number.isFinite(d.lon));const now=new Set();
    const off=new Map(),group=new Map();
    for(const [k,g] of groupsOf(keep)){const o=fanOut(g,spread.has(k)?SPREAD_PX:FAN_PX);for(const a of g){off.set(a.id,o.get(a.id));group.set(a.id,g.length>1&&!spread.has(k)?k:null);}}
    for(const d of keep){const st=cardStatus(d.status);now.add(d.id);
      living.putOther?living.putOther({id:d.id,name:d.name||'Agent',lat:d.lat,lon:d.lon,look:d.look,approx:{lat:d.lat,lon:d.lon},status:st||undefined,other:true,meta:'Around town · approximate area'})
        :agents.put({id:d.id,name:d.name||'Agent',lat:d.lat,lon:d.lon,look:d.look,other:true});
      const a=agents.get(d.id);if(!a)continue;a.marker.setOffset([off.get(d.id)[0],-6+off.get(d.id)[1]]);a.townGroup=group.get(d.id);hookTap(a);}
    for(const id of drawn)if(!now.has(id))agents.remove(id);drawn=now;queueClear();return keep.length;}
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
  function clearMap(){for(const id of drawn)agents.remove(id);drawn=new Set();myId=null;}
  async function loadFeed(user=getUser()){if(!el)return;const n=++seq;el.innerHTML=SKELETON;el.setAttribute('aria-busy','true');
    if(!isReal(user)){el.innerHTML='<p class="fdEmpty">Sign in to see what your agent and others have been up to.</p>';el.removeAttribute('aria-busy');return;}
    try{const f=await feed(user);if(n!==seq)return;if(f.myId)myId=f.myId;el.innerHTML=feedHtml(f);}
    catch(e){if(n!==seq)return;console.warn('feed',e?.message);el.innerHTML='<p class="fdEmpty">Feed is resting. Try again in a minute.</p>';}
    el.removeAttribute('aria-busy');}
  async function loadActivity(user=getUser()){if(!actEl)return;const n=++aseq;actEl.innerHTML=ACT_SKELETON;actEl.setAttribute('aria-busy','true');
    if(!isReal(user)){actEl.innerHTML='<p class="fdEmpty">Sign in to see what your agent has been up to.</p>';actEl.removeAttribute('aria-busy');return;}
    try{const f=await feed(user);if(n!==aseq)return;if(f.myId)myId=f.myId;actEl.innerHTML=activityHtml(f,{dismissed:store('vw-wm-done')});
      const seen=store('vw-wm-seen');for(const e of worthMeeting(f))seen.add(e.id);save('vw-wm-seen',seen);if(dotEl)dotEl.hidden=true;}
    catch(e){if(n!==aseq)return;console.warn('activity',e?.message);actEl.innerHTML='<p class="fdEmpty">Activity is resting. Try again in a minute.</p>';}
    actEl.removeAttribute('aria-busy');}
  // Unread dot on the Agent chats rail button: worth-meeting notes not opened yet.
  async function checkUnread(user=getUser()){if(!dotEl||!isReal(user))return 0;try{const seen=store('vw-wm-seen');const n=worthMeeting(await feed(user)).filter(e=>!seen.has(e.id)).length;dotEl.hidden=!n;return n;}catch{return 0;}}
  el?.addEventListener('click',toggleMeet);
  actEl?.addEventListener('click',ev=>{const b=ev.target.closest('.wm button');if(!b)return toggleMeet(ev);const li=b.closest('.wm'),id=li.dataset.id;
    // "Say hi" only opens a local draft on this device. Nothing is sent anywhere.
    if(b.classList.contains('hi')){if(!li.querySelector('.draft')){const t=document.createElement('textarea');t.className='draft';t.maxLength=280;t.rows=2;t.setAttribute('aria-label','Draft message (not sent)');
      const k='vw-wm-draft:'+id;t.value=localStorage.getItem(k)||`Hi ${b.dataset.name||'there'}, my agent said we might get along.`;t.oninput=()=>{try{localStorage.setItem(k,t.value);}catch{/* blocked */}};
      const sm=document.createElement('small');sm.className='draftNote';sm.textContent='Draft saved on this device. Nothing is sent.';li.querySelector('.acts').before(t,sm);t.focus({preventScroll:true});}return;}
    else{const sec=li.closest('.wmSec');li.remove();if(sec&&!sec.querySelector('.wm'))sec.remove();}
    const d=store('vw-wm-done');d.add(id);save('vw-wm-done',d);});
  const fresh=()=>{fc=null;};
  return {refreshMap,clearMap,loadFeed,loadActivity,checkUnread,fresh,draw,keepClear,expand,get myId(){return myId;},set myId(v){myId=v;}};}
