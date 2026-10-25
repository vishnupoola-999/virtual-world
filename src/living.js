// Living agents on the World map (design/living-spec.md §2): walking, meeting and working states with a status pill,
// owner-only route line, a soft link between two meeting agents, and the bottom hint card for your own agent.
// Reads agent.status {kind,label,...} defensively; until the backend writes it, falls back to the life loop's
// life.activity/life.status strings, and otherwise to idle. Privacy: other people's agents only ever get kind + label,
// drawn at an approximate area; no route, destination or exact spot is used for them.
import {agentsOnMap} from './world-agents.js';
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
  const label=String(s.label||(typeof a?.status==='string'?'':life.status)||'').replace(/\s+/g,' ').trim().slice(0,40);
  const d=s.destination,dest=d&&ll(d.lngLat)?{name:String(d.name||'').slice(0,30),lngLat:ll(d.lngLat)}:null;
  const p=s.progress,prog=p&&num(p.done)&&num(p.total)&&p.total>0?{done:Math.max(0,Math.min(p.done,p.total)),total:p.total}:null;
  if(kind!=='idle'&&!label)kind='idle';
  return {kind,label,destination:dest,withAgentId:typeof s.withAgentId==='string'?s.withAgentId:null,progress:prog,
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
    map.addSource('lv-route',{type:'geojson',lineMetrics:true,data:empty});map.addSource('lv-link',{type:'geojson',lineMetrics:true,data:empty});
    map.addLayer({id:'lv-route-glow',type:'line',source:'lv-route',paint:{'line-color':'#8b7bff','line-width':14,'line-blur':8,'line-opacity':.45}});
    map.addLayer({id:'lv-route',type:'line',source:'lv-route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-width':5,'line-gradient':grad}});
    map.addLayer({id:'lv-link-glow',type:'line',source:'lv-link',paint:{'line-color':'#4fd1ff','line-width':14,'line-blur':10,'line-opacity':.3}});
    map.addLayer({id:'lv-link',type:'line',source:'lv-link',layout:{'line-cap':'round'},paint:{'line-width':2,'line-opacity':.8,'line-gradient':grad}});
    if(own)showOwn(own.agent,own.opts);}
  if(map.isStyleLoaded())layers();map.on('style.load',layers);map.on('load',layers);
  const set=(id,d)=>map.getSource(id)?.setData(d);
  function hint(st,name,opts){if(!hintEl)return;const on=st.kind!=='idle';hintEl.hidden=!on;document.body.classList.toggle('hint-on',on);if(!on)return;
    const n=esc(name||'Your agent');let b,d;
    if(st.kind==='walking'){b=`${n} is on the move`;d=st.detail||st.label;}
    else if(st.kind==='meeting'){const who=opts.partnerName?`${esc(opts.partnerName)}'s agent`:'another agent';b=`${n} met ${who}`;d=st.detail||(st.shared.length?`You both like ${st.shared.join(' and ')}.`:st.label);}
    else{b=st.progress?`${st.progress.done} of ${st.progress.total} done`:esc(st.label);d=st.detail||(st.progress?st.label:'');}
    hintEl.innerHTML=`<span class="ic">${svg(ICON[st.kind])}</span><div><b>${b}</b>${esc(d)}</div>`;}
  // Your own agent. opts.partnerName: the name stored with the meeting (never looked up from the partner's profile).
  function showOwn(agent,opts={}){const prev=own?.partners||[];own={agent,opts,partners:[]};const st=readStatus(agent),me=agents.get('me');
    dest?.remove();dest=null;set('lv-route',empty);set('lv-link',empty);
    for(const id of prev)agents.setLiving(id,null);
    if(!me){hint({kind:'idle'});return st;}
    let yaw;
    if(st.kind==='walking'&&st.destination){const from=[me.lon,me.lat],to=st.destination.lngLat;
      set('lv-route',line(opts.route&&opts.route.length>1?opts.route:[from,to]));
      if(st.destination.name){const d=document.createElement('div');d.className='dest glass';d.innerHTML=svg('bldg')+esc(st.destination.name);
        dest=new maplibregl.Marker({element:d,anchor:'bottom'}).setLngLat(to).addTo(map);}
      yaw=-1.0;}
    if(st.kind==='meeting'&&st.withAgentId){const p=agents.get(st.withAgentId)||agents.get('f-'+st.withAgentId);
      if(p){set('lv-link',line([[me.lon,me.lat],[p.lon,p.lat]]));const left=map.project([me.lon,me.lat]).x<=map.project([p.lon,p.lat]).x;
        yaw=left?1.15:-1.15;agents.setLiving(p.id,{kind:'idle'},left?-1.15:1.15);own.partners=[p.id];}}
    agents.setLiving('me',{kind:st.kind,html:pillHtml(st)},yaw);hint(st,agent?.name,opts);return st;}
  // Someone else's agent: kind + label only, at an approximate area. Destination, route and progress are ignored.
  function putOther(d){const st=readStatus(d),p=d.approx&&num(d.approx.lat)&&num(d.approx.lon)?d.approx:approx(d.lat,d.lon);
    agents.put({id:d.id,name:d.name,lat:p.lat,lon:p.lon,look:d.look,ownerName:d.ownerName,meta:d.meta||'Friend · approximate area',status:st.label||undefined,other:!!d.other});
    const safe={...st,destination:null,progress:null};agents.setLiving(d.id,{kind:st.kind,html:pillHtml(safe)});return safe;}
  return {showOwn,putOther,readStatus};}
