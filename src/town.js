// Living map + Feed (design/living-map-feed). Signed-in (non-anonymous) users see other people's public agent cards
// (publicAgents, written by the life loop at ~1 km precision) and a Feed sheet from the proxy's GET /feed.
// The caller's own card (doc id === /feed myId) is skipped: their agent is already drawn as 'me'.
// Anonymous users, network errors and missing config all fail quietly: no others on the map, a calm Feed message.
const PROJ='virtual-world-8ac82',FS_DB='default'; // same as firebase.js (kept here so this module has no CDN imports)
export const FEED_URL='https://virtual-world-ai.onrender.com/feed?n=30';
export const FAN_PX=24;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fromRest=v=>v==null?null:'stringValue' in v?v.stringValue:'doubleValue' in v?v.doubleValue:'integerValue' in v?Number(v.integerValue)
  :'booleanValue' in v?v.booleanValue:'timestampValue' in v?v.timestampValue:'mapValue' in v?Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,fromRest(x)]))
  :'arrayValue' in v?(v.arrayValue.values||[]).map(fromRest):null;
export const clip=(s,n=40)=>{s=String(s||'').replace(/\s+/g,' ').trim();return s.length>n?s.slice(0,n-1).trimEnd()+'…':s;};
// Public card status may be {kind,label} or a plain string. Labels are capped at 40 characters.
export function cardStatus(st){if(typeof st==='string')return st.trim()?{kind:'walking',label:clip(st)}:null;
  if(st&&typeof st==='object'&&st.label)return {...st,label:clip(st.label)};return null;}
// Agents sharing a spot fan out around it by ~24px. Returns Map id -> [dx,dy] in px.
export function fanOut(list,px=FAN_PX){const groups=new Map(),out=new Map();
  for(const a of list){const k=a.lat.toFixed(3)+','+a.lon.toFixed(3);(groups.get(k)||groups.set(k,[]).get(k)).push(a.id);}
  for(const ids of groups.values()){if(ids.length===1){out.set(ids[0],[0,0]);continue;}
    ids.forEach((id,i)=>{const t=-Math.PI/2+i*2*Math.PI/ids.length;out.set(id,[Math.round(Math.cos(t)*px),Math.round(Math.sin(t)*px*.5)]);});}
  return out;}
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
  const body=(sh.length?`<p>Both like ${sh.join(' and ')}.</p>`:'')+lines.map(l=>`<p><b>${esc(l.speaker)}</b> ${esc(l.text)}</p>`).join('');
  return `<li class="fd meet"><button type="button" class="fdHead" aria-expanded="false"><span class="fdDot"></span><span class="fdT">${mine?'Met '+who:who+' met'}</span><small>${ago(e.at)}</small></button>${body?`<div class="fdBody">${body}</div>`:''}</li>`;}
const diaryRow=e=>`<li class="fd"><div class="fdHead"><span class="fdDot dim"></span><span class="fdT">${esc(clip(e.text,120))}</span><small>${ago(e.at)}</small></div></li>`;
export const EMPTY='Nothing yet. Bs is out exploring.';
export function feedHtml(f){const mine=(f.mine||[]),town=(f.town||[]);if(!mine.length&&!town.length)return `<p class="fdEmpty">${EMPTY}</p>`;
  return `<div class="fdSec">Your agent</div>`+(mine.length?`<ul>${mine.map(e=>e.kind==='meet'?meetRow(e,true):diaryRow(e)).join('')}</ul>`:`<p class="fdNone">${EMPTY}</p>`)+
    `<div class="fdSec">Around town</div>`+(town.length?`<ul>${town.map(e=>meetRow(e,false)).join('')}</ul>`:`<p class="fdNone">No meets around town yet.</p>`);}
export const SKELETON=`<div class="fdSec">Your agent</div><ul class="fdSk" aria-hidden="true"><li></li><li></li><li></li></ul><div class="fdSec">Around town</div><ul class="fdSk" aria-hidden="true"><li></li><li></li></ul>`;

export function setupTown({agents,living,getUser,el,deps={}}){const F={fetchPublicAgents,fetchFeed,...deps};let myId=null,drawn=new Set(),seq=0;
  async function ensureMyId(u){if(myId)return myId;try{myId=(await F.fetchFeed(u)).myId;}catch{/* feed down: still draw others */}return myId;}
  function draw(list){const keep=list.filter(d=>d&&d.id&&d.id!==myId&&Number.isFinite(d.lat)&&Number.isFinite(d.lon));const off=fanOut(keep);const now=new Set();
    for(const d of keep){const st=cardStatus(d.status);now.add(d.id);
      living.putOther?living.putOther({id:d.id,name:d.name||'Agent',lat:d.lat,lon:d.lon,look:d.look,approx:{lat:d.lat,lon:d.lon},status:st||undefined,other:true,meta:'Around town · approximate area'})
        :agents.put({id:d.id,name:d.name||'Agent',lat:d.lat,lon:d.lon,look:d.look,other:true});
      agents.get(d.id)?.marker.setOffset([off.get(d.id)[0],-6+off.get(d.id)[1]]);}
    for(const id of drawn)if(!now.has(id))agents.remove(id);drawn=now;return keep.length;}
  async function refreshMap(user=getUser()){if(!isReal(user)){clearMap();return 0;}
    try{await ensureMyId(user);return draw(await F.fetchPublicAgents(user));}catch(e){console.warn('town',e?.message);return 0;}}
  function clearMap(){for(const id of drawn)agents.remove(id);drawn=new Set();myId=null;}
  async function loadFeed(user=getUser()){if(!el)return;const n=++seq;el.innerHTML=SKELETON;el.setAttribute('aria-busy','true');
    if(!isReal(user)){el.innerHTML='<p class="fdEmpty">Sign in to see what your agent and others have been up to.</p>';el.removeAttribute('aria-busy');return;}
    try{const f=await F.fetchFeed(user);if(n!==seq)return;if(f.myId)myId=f.myId;el.innerHTML=feedHtml(f);}
    catch(e){if(n!==seq)return;console.warn('feed',e?.message);el.innerHTML='<p class="fdEmpty">Feed is resting. Try again in a minute.</p>';}
    el.removeAttribute('aria-busy');}
  el?.addEventListener('click',e=>{const h=e.target.closest('.meet>.fdHead');if(!h)return;const li=h.parentElement,on=!li.classList.contains('open');li.classList.toggle('open',on);h.setAttribute('aria-expanded',String(on));});
  return {refreshMap,clearMap,loadFeed,draw,get myId(){return myId;},set myId(v){myId=v;}};}
