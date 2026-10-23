import {createMap,flyTo,search,HOME} from './map.js';
import {connect,roomFromUrl,joinLink} from './family.js';
import {familyLayer} from './family-layer.js';
import {flightsLayer} from './flights.js';
const $=id=>document.getElementById(id);const status=t=>$('status').textContent=t;
const map=createMap('map');window.__map=map;
map.on('error',e=>console.warn('map:',e.error?.message||e));
// search
$('searchF').onsubmit=async e=>{e.preventDefault();const q=$('q').value.trim();if(!q)return;$('results').textContent='Searching…';
  try{const rs=await search(q);$('results').innerHTML='';if(!rs.length)$('results').textContent='No results';
    for(const r of rs){const d=document.createElement('div');d.textContent=r.display_name;d.onclick=()=>{flyTo(map,+r.lon,+r.lat,r.type==='city'||r.addresstype==='city'?14:17);$('results').innerHTML='';};$('results').appendChild(d);}}
  catch(err){$('results').textContent='Search failed: '+err.message;}};
// my location (opt-in, stays in this browser)
let me=null;
$('meBtn').onclick=()=>{if(!navigator.geolocation)return status('Location not supported');status('Asking for location…');
  navigator.geolocation.getCurrentPosition(p=>{const ll=[p.coords.longitude,p.coords.latitude];
    if(!me){const el=document.createElement('div');el.className='me';me=new maplibregl.Marker({element:el}).setLngLat(ll).addTo(map);}else me.setLngLat(ll);
    flyTo(map,...ll,18);status(`You are here (±${Math.round(p.coords.accuracy)} m). Not shared with anyone.`);},e=>status('Location error: '+e.message),{enableHighAccuracy:true});};
$('homeBtn').onclick=()=>map.flyTo({center:[HOME.lng,HOME.lat],zoom:16.3,pitch:60,bearing:-20});
$('globeBtn').onclick=()=>map.flyTo({zoom:1.6,pitch:0,bearing:0});
// flights
const flt=flightsLayer(map,{onMsg:t=>$('fltMsg').textContent=t});
$('fltBtn').onclick=()=>$('fltBtn').textContent='✈️ Flights: '+(flt.toggle()?'ON':'OFF');
// family
const room=roomFromUrl();$('joinLink').href=joinLink(room);
$('shareBtn').onclick=async()=>{const l=joinLink(room);try{if(navigator.share)await navigator.share({title:'Join our Virtual World',url:l});else await navigator.clipboard.writeText(l);$('shareMsg').textContent='✅ Link copied, send it only to family';}catch{prompt('Copy this link and send it to family:',l);}};
const famL=familyLayer(map,{onChange:renderFam});
function renderFam(fam){$('famN').textContent=fam.size;const L=$('famList');L.innerHTML='';
  for(const f of fam.values()){const d=document.createElement('div');d.className='famItem';const b=document.createElement('b');b.textContent=f.data.name||'Family';
    const go=document.createElement('button');go.textContent='🎯 Go to';go.onclick=()=>flyTo(map,f.data.lon,f.data.lat,18);d.append(b,' ',go);L.appendChild(d);}}
const relay=connect(room,{onPresence:famL.update,onStatus:s=>$('famConn').textContent='('+s+')'});
window.__vw={fam:famL.fam,relay,famUpdate:famL.update};
if(new URLSearchParams(location.search).get('flights'))$('fltBtn').click();
