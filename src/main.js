import {createMap,flyTo,search,HOME} from './map.js';
import {connect,roomFromUrl,joinLink} from './family.js';
import {familyLayer} from './family-layer.js';
import {flightsLayer} from './flights.js';
import {setupAgent} from './agent.js';
import {setupChat} from './chat.js';
import {currentUser} from './firebase.js';
import {setupUI,toast,closeSheet,openSheet} from './ui.js';
const $=id=>document.getElementById(id);
setupUI();
const map=createMap('map');window.__map=map;
map.on('error',e=>console.warn('map:',e.error?.message||e));
// search
$('searchF').onsubmit=async e=>{e.preventDefault();const q=$('q').value.trim();if(!q)return;$('results').textContent='Searching…';
  try{const rs=await search(q);$('results').innerHTML='';if(!rs.length)$('results').textContent='No results';
    for(const r of rs){const d=document.createElement('div');d.textContent=r.display_name;d.onclick=()=>{flyTo(map,+r.lon,+r.lat,r.type==='city'||r.addresstype==='city'?14:17);$('results').innerHTML='';$('q').blur();closeSheet();};$('results').appendChild(d);}}
  catch(err){$('results').textContent='Search failed: '+err.message;}};
// my location (opt-in, stays in this browser)
let me=null;
$('meBtn').onclick=()=>{if(!navigator.geolocation)return toast('Location not supported');toast('Asking for location…',0);
  navigator.geolocation.getCurrentPosition(p=>{const ll=[p.coords.longitude,p.coords.latitude];
    if(!me){const el=document.createElement('div');el.className='me';me=new maplibregl.Marker({element:el}).setLngLat(ll).addTo(map);}else me.setLngLat(ll);
    flyTo(map,...ll,18);toast(`📍 You are here (±${Math.round(p.coords.accuracy)} m). Not shared.`);},e=>toast('Location error: '+e.message),{enableHighAccuracy:true,timeout:20000});};
$('homeBtn').onclick=()=>{closeSheet();map.flyTo({center:[HOME.lng,HOME.lat],zoom:16.3,pitch:60,bearing:-20});};
$('globeBtn').onclick=()=>{closeSheet();map.flyTo({zoom:1.6,pitch:0,bearing:0});};
// flights
const flt=flightsLayer(map,{onMsg:t=>$('fltMsg').textContent=t});
$('fltBtn').onclick=()=>$('fltBtn').textContent='✈️ Flights: '+(flt.toggle()?'ON':'OFF');
// family
const room=roomFromUrl();
$('shareBtn').onclick=async()=>{const l=joinLink(room);try{if(navigator.share)await navigator.share({title:'Join our Virtual World',url:l});else await navigator.clipboard.writeText(l);$('shareMsg').textContent='✅ Link copied, send it only to family';}catch{prompt('Copy this link and send it to family:',l);}};
const myId=localStorage.getItem('vw-me')||crypto.randomUUID().slice(0,12);localStorage.setItem('vw-me',myId);
const famL0=familyLayer(map,{onChange:renderFam});const famL={fam:famL0.fam,update:d=>{if(d.id!==myId)famL0.update(d);}};
function renderFam(fam){$('famN').textContent=fam.size||'';$('famN2').textContent=fam.size;const L=$('famList');L.innerHTML='';
  for(const f of fam.values()){const d=document.createElement('div');d.className='famItem';const b=document.createElement('b');b.textContent=f.data.name||'Family';
    const go=document.createElement('button');go.textContent='🎯 Go to';go.onclick=()=>{closeSheet();flyTo(map,f.data.lon,f.data.lat,18);};d.append(b,' ',go);L.appendChild(d);}}
renderFam(famL.fam);
const relay=connect(room,{onPresence:famL.update,onStatus:s=>$('famConn').textContent='('+s+')'});
window.__vw={fam:famL.fam,relay,famUpdate:famL.update};
if(new URLSearchParams(location.search).get('flights'))$('fltBtn').click();
window.__vw.agent=setupAgent(map);
setupChat(()=>window.__vw.agent.agent,currentUser);
// Share my own live location from inside the app, so the map (and my agent) stay on screen.
let watch=null,timer=null,lastPos=null;
const myName=()=>currentUser()?.displayName||localStorage.getItem('vw-name')||'Family member';
const sendPos=()=>{if(lastPos)relay.publish(myId,{name:myName(),...lastPos,ts:Date.now()});};
function stopLive(){if(watch!==null)navigator.geolocation.clearWatch(watch);clearInterval(timer);watch=timer=null;lastPos=null;relay.clear(myId);$('liveBtn').classList.remove('on');$('liveBtn').textContent='📡 Share my live location';}
$('liveBtn').onclick=()=>{if(watch!==null){stopLive();return toast('Stopped sharing');}
  if(!confirm('Share your live location with your family while the app is open?'))return;
  if(!currentUser()&&!localStorage.getItem('vw-name')){const n=prompt('Your name for the family map:');if(!n)return;localStorage.setItem('vw-name',n.slice(0,24));}
  watch=navigator.geolocation.watchPosition(p=>{const f=!lastPos;lastPos={lat:p.coords.latitude,lon:p.coords.longitude,acc:Math.round(p.coords.accuracy)};if(f){sendPos();toast('📡 Sharing with family');}},e=>{toast('Location error: '+e.message);stopLive();},{enableHighAccuracy:true,maximumAge:5000});
  timer=setInterval(sendPos,5000);$('liveBtn').classList.add('on');$('liveBtn').textContent='⛔ Stop sharing';};
addEventListener('pagehide',()=>{if(watch!==null)relay.clear(myId);});
if(new URLSearchParams(location.search).get('room'))setTimeout(()=>openSheet('family'),800);
// PWA
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('sw.js').catch(e=>console.warn('sw',e));
