// Living agents on the World map (design/living-spec.md §2): walking, meeting and working states with a status pill,
// owner-only route line, a soft link between two meeting agents, and the bottom hint card for your own agent.
// Reads agent.status {kind,label,...} defensively; until the backend writes it, falls back to the life loop's
// life.activity/life.status strings, and otherwise to idle. Privacy: other people's agents only ever get kind + label,
// drawn at an approximate area; no route, destination or exact spot is used for them.
import {agentsOnMap} from './world-agents.js';
import {displayName,displayLabel,isTownName} from './names.js';
export const MEET_YAW=Math.PI/6; // ~30 degrees
const KINDS=new Set(['walking','meeting','working','idle']);
const FROM_ACTIVITY={move:'walking',meet:'meeting',work:'working'};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const I={pin:'<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  chat:'<path d="M4 5h16v11H9l-5 4z"/>',bldg:'<path d="M4 21V5l8-2v18M12 8h8v13M8 8v.01M8 12v.01M8 16v.01M16 12v.01M16 16v.01M2 21h20"/>'};
const svg=k=>`<svg viewBox="0 0 24 24" aria-hidden="true">${I[k]}</svg>`;
const ICON={walking:'pin',meeting:'chat',working:'mail'};
const num=v=>typeof v==='number'&&isFinite(v);
const ll=v=>Array.isArray(v)&&v.length===2&&num(+v[0])&&num(+v[1])?[+v[0],+v[1]]:null;

// Normalised status from an agent doc. Never throws; unknown or missing data → idle.
export function readStatus(a){const s=a&&typeof a.status==='object'&&a.status||{},life=a&&typeof a.life==='object'&&a.life||{};
  let kind=KINDS.has(s.kind)?s.kind:FROM_ACTIVITY[life.activity]||'idle';
  const label=displayLabel(s.label||(typeof a?.status==='string'?'':life.status)||'').replace(/\s+/g,' ').trim().slice(0,40);
  const d=s.destination,dest=d&&ll(d.lngLat)?{name:String(d.name||'').slice(0,30),lngLat:ll(d.lngLat)}:null;
  const p=s.progress,prog=p&&num(p.done)&&num(p.total)&&p.total>0?{done:Math.max(0,Math.min(p.done,p.total)),total:p.total}:null;
  if(kind!=='idle'&&!label)kind='idle';
  const wll=ll(s.withLngLat)||ll(s.with?.lngLat);
  return {kind,label,destination:dest,withAgentId:typeof s.withAgentId==='string'?s.withAgentId:null,withName:typeof s.withName==='string'?s.withName:'',withTown:isTownName(s.withName)||isTownName(s.label)||/^town-/.test(s.withAgentId||''),withLngLat:wll,withLook:s.withLook||s.with?.look||null,progress:prog,
    detail:String(s.detail||'').slice(0,80),shared:Array.isArray(s.shared)?s.shared.filter(x=>typeof x==='string').slice(0,3):[]};}
// "Heading to T-Hub · 4 min" → main text + muted small part.
function pillHtml(st){if(st.kind==='idle')return '';const [main,...rest]=st.label.split(' · ');
  return `<span class="ico">${svg(ICON[st.kind])}</span>${esc(main)}${rest.length?` <small>· ${esc(rest.join(' · '))}</small>`:''}`+(st.kind==='working'?' <span class="prog"></span>':'');}
// Friends' agents are drawn at an approximate area only (2 decimals ≈ 1 km), same rounding as agent.approx.
export const approx=(lat,lon)=>({lat:Math.round(lat*100)/100,lon:Math.round(lon*100)/100});

export function setupLiving(map,{hintEl}={}){const agents=agentsOnMap(map);let dest=null,own=null;
  const empty={type:'FeatureCollection',features:[]};
  const line=c=>({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:c}});
  const grad=['interpolate',['linear'],['line-progress'],0,'#8b7bff',1,'#4fd1ff'];
  function layers(){if(!map.getStyle?.()||map.getSource('lv-route'))return;
    map.addSource('lv-route',{type:'geojson',lineMetrics:true,data:empty});
    map.addLayer({id:'lv-route-glow',type:'line',source:'lv-route',paint:{'line-color':'#8b7bff','line-width':14,'line-blur':8,'line-opacity':.45}});
    map.addLayer({id:'lv-route',type:'line',source:'lv-route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-width':5,'line-gradient':grad}});
    if(own)showOwn(own.agent,own.opts);}
  if(map.isStyleLoaded())layers();map.on('style.load',layers);map.on('load',layers);
  const set=(id,d)=>map.getSource(id)?.setData(d);
  function hint(st,name,opts){if(!hintEl)return;const on=st.kind!=='idle';hintEl.hidden=!on;document.body.classList.toggle('hint-on',on);if(!on){hintEl.dataset.k='';return;}
    const n=esc(name||'Your agent');let b,d;
    if(st.kind==='walking'){b=`${n} is on the move`;d=st.detail||st.label;}
    else if(st.kind==='meeting'){const pn=displayName(opts.partnerName||st.withName);
      if(st.withTown||!opts.partnerName){b=pn?`Chatting with ${esc(pn)}`:`${n} is meeting someone`;d=st.detail||(st.shared.length?`You both like ${st.shared.join(' and ')}.`:'Saying hello around town');}
      else{b=`${n} met ${esc(pn)}'s agent`;d=st.detail||(st.shared.length?`You both like ${st.shared.join(' and ')}.`:st.label);}}
    else{b=st.progress?`${st.progress.done} of ${st.progress.total} done`:esc(st.label);d=st.detail||(st.progress?st.label:'');}
    const h=`<span class="ic">${svg(ICON[st.kind])}</span><div><b>${b}</b>${esc(d)}</div>`;if(hintEl.dataset.k===h)return;
    // Cross-fade on text change: restart a short opacity/transform animation (no layout properties animate).
    const was=!!hintEl.dataset.k;hintEl.dataset.k=h;hintEl.innerHTML=h;if(was){hintEl.classList.remove('swap');void hintEl.offsetWidth;hintEl.classList.add('swap');}}
  // Your own agent. opts.partnerName: the name stored with the meeting (never looked up from the partner's profile).
  // Town agents (built-in neighbours) have no map card: while yours meets one, a visible character walks in beside yours
  // (or stands at the position /feed gives, when present), faces it, and fades out after. No pill, like everyone else's.
  let guest=null;const GUEST_COL=['#4fd1ff','#8b7bff','#3ddc97','#ffc861','#ff7a9c','#7aa2ff','#c38bff','#5be0c4'];
  // /feed (PR #45, optional): mine[].partner for town meets {id,name,look:{colorIndex},offsetM:{east,north}}. Feature-detected.
  let partners=new Map();function setPartners(list){partners=new Map();for(const p of list||[])if(p&&typeof p==='object'){if(p.id)partners.set(String(p.id),p);if(p.name)partners.set('n:'+displayName(p.name),p);}}
  function spawnGuest(st,me){const id=st.withAgentId||'town-guest',name=displayName(st.withName)||'Neighbour';
    const pi=partners.get(id)||partners.get('n:'+name),o=pi?.offsetM;
    if(pi?.look&&Number.isInteger(pi.look.colorIndex)&&!st.withLook)st={...st,withLook:{color:GUEST_COL[((pi.look.colorIndex%8)+8)%8]}};
    const off=o&&num(o.east)&&num(o.north)?[me.lon+o.east/(111320*Math.cos(me.lat*Math.PI/180)),me.lat+o.north/110540]:null;
    const to=st.withLngLat||off||[me.lon-0.00016,me.lat],from=[to[0]-0.00025,to[1]];
    // Deterministic outfit colour from the name; the art itself is untouched.
    const look=st.withLook||{color:GUEST_COL[[...name].reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,7)%GUEST_COL.length]};
    if(guest&&guest!==id)dropGuest();
    if(!agents.get(id)){agents.put({id,name,lat:from[1],lon:from[0],look,ownerName:name,other:true,meta:'Neighbour'});agents.get(id)?.el.classList.add('town');}
    agents.put({id,name,lat:to[1],lon:to[0],look,ownerName:name,other:true,meta:'Neighbour'});guest=id;return agents.get(id);}
  function dropGuest(){if(!guest)return;const id=guest,a=agents.get(id);guest=null;if(!a)return;a.el.classList.add('leave');setTimeout(()=>{if(guest!==id)agents.remove(id);},REDUCE()?0:320);}
  const REDUCE=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Pills and bubbles stay 16px inside the screen edges (CSS translate composes with MapLibre's marker transform).
  let cq=0;function clampSoon(){if(cq)return;cq=requestAnimationFrame(()=>{cq=0;clampAll();});}
  function clampAll(){const W=innerWidth;for(const e of document.querySelectorAll('.ag .stat:not([hidden]),.ag .bubble:not([hidden])')){e.style.translate='';const r=e.getBoundingClientRect();if(!r.width)continue;
    const dx=r.left<16?16-r.left:r.right>W-16?W-16-r.right:0;if(dx)e.style.translate=Math.round(dx)+'px 0';}}
  map.on('move',clampSoon);addEventListener('resize',clampSoon);
  function showOwn(agent,opts={}){const prev=own?.partners||[];own={agent,opts,partners:[]};const st=readStatus(agent),me=agents.get('me');
    dest?.remove();dest=null;set('lv-route',empty);
    for(const id of prev)if(id!==guest)agents.setLiving(id,null);
    if(!(st.kind==='meeting'&&me&&st.withAgentId&&!agents.get('f-'+st.withAgentId)&&(st.withTown||(!agents.get(st.withAgentId)||agents.get(st.withAgentId).el.classList.contains('town')))))dropGuest();
    else spawnGuest(st,me);
    if(!me){hint({kind:'idle'});return st;}
    let yaw;
    if(st.kind==='walking'&&st.destination){const from=[me.lon,me.lat],to=st.destination.lngLat;
      set('lv-route',line(opts.route&&opts.route.length>1?opts.route:[from,to]));
      if(st.destination.name){const d=document.createElement('div');d.className='dest glass';d.innerHTML=svg('bldg')+esc(st.destination.name);
        dest=new maplibregl.Marker({element:d,anchor:'bottom'}).setLngLat(to).addTo(map);}
      yaw=-1.0;}
    if(st.kind==='meeting'&&st.withAgentId){const p=agents.get(st.withAgentId)||agents.get('f-'+st.withAgentId);
      // Diggy: no connecting line; both characters turn ~30 degrees toward each other (eased in world-agents.js) and turn back after.
      if(p){const left=map.project([me.lon,me.lat]).x<=map.project([p.lon,p.lat]).x;
        yaw=left?MEET_YAW:-MEET_YAW;agents.setLiving(p.id,{kind:'idle'},left?-MEET_YAW:MEET_YAW);own.partners=[p.id];}}
    // The bottom card already says it, so the pill above your head does not repeat it (the meet bubble shows dots only).
    agents.setLiving('me',{kind:st.kind,html:hintEl?'':pillHtml(st)},yaw);hint(st,agent?.name,opts);clampSoon();return st;}
  // Someone else's agent: kind + label only, at an approximate area. Destination, route and progress are ignored.
  function putOther(d){const st=readStatus(d),p=d.approx&&num(d.approx.lat)&&num(d.approx.lon)?d.approx:approx(d.lat,d.lon);
    agents.put({id:d.id,name:d.name,lat:p.lat,lon:p.lon,look:d.look,ownerName:d.ownerName,meta:d.meta||'Friend · approximate area',status:st.label||undefined,other:!!d.other});
    const safe={...st,destination:null,progress:null};agents.setLiving(d.id,{kind:st.kind,html:pillHtml(safe)});return safe;}
  return {showOwn,putOther,readStatus,setPartners,townColour:i=>GUEST_COL[((i%8)+8)%8]};}
