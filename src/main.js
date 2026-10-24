import {createMap,flyTo,search,HOME} from './map.js';
import {connect,roomFromUrl,joinLink} from './family.js';
import {familyLayer} from './family-layer.js';
import {flightsLayer} from './flights.js';
import {setupAgent} from './agent.js';
import {setupOnboarding} from './onboarding.js';
import {setupChat} from './chat.js';
import {chatHero} from './chat-hero.js';
import {setupTabs} from './tabs.js';
import {currentUser,onUser} from './firebase.js';
import {setupUI,toast,closeSheet,openSheet,dragToClose} from './ui.js';
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
    // With an agent, the character itself stands at your position; the plain dot is only for people without one.
    if(window.__vw.agent?.setLive({lat:ll[1],lon:ll[0]})){me?.remove();me=null;}
    else if(!me){const el=document.createElement('div');el.className='me';me=new maplibregl.Marker({element:el}).setLngLat(ll).addTo(map);}else me.setLngLat(ll);
    flyTo(map,...ll,18);toast(`📍 You are here (±${Math.round(p.coords.accuracy)} m). Not shared.`);},e=>toast('Location error: '+e.message),{enableHighAccuracy:true,timeout:20000});};
$('homeBtn').onclick=()=>{closeSheet();map.flyTo({center:[HOME.lng,HOME.lat],zoom:16.3,pitch:60,bearing:-20});};
$('globeBtn').onclick=()=>{closeSheet();map.flyTo({zoom:1.6,pitch:0,bearing:0});};
// flights
const flt=flightsLayer(map,{onMsg:t=>$('fltMsg').textContent=t,getUser:currentUser});
$('fltBtn').onclick=()=>$('fltBtn').textContent='✈️ Flights: '+(flt.toggle()?'ON':'OFF');
// family
const room=roomFromUrl();
$('shareBtn').onclick=async()=>{const l=joinLink(room);try{if(navigator.share)await navigator.share({title:'Join our Virtual World',url:l});else await navigator.clipboard.writeText(l);$('shareMsg').textContent='✅ Link copied, send it only to family';}catch{prompt('Copy this link and send it to family:',l);}};
const myId=localStorage.getItem('vw-me')||crypto.randomUUID().slice(0,12);localStorage.setItem('vw-me',myId);
const famL0=familyLayer(map,{onChange:renderFam});const myKey=()=>currentUser()?.uid||myId;const usedKeys=new Set([myId]);const famL={fam:famL0.fam,update:d=>{if(d.id!==myId&&d.id!==myKey())famL0.update(d);}};
// When sign-in restores, drop my own dot if a relay update arrived before we knew who I am.
onUser(u=>{if(u){usedKeys.add(u.uid);if(famL0.fam.has(u.uid))famL0.update({id:u.uid,stop:true});}});
function renderFam(fam){$('famN').textContent=fam.size||'';$('famN2').textContent=fam.size;const L=$('famList');L.innerHTML='';
  for(const f of fam.values()){const d=document.createElement('div');d.className='famItem';const b=document.createElement('b');b.textContent=f.data.name||'Family';
    const go=document.createElement('button');go.textContent='🎯 Go to';go.onclick=()=>{closeSheet();flyTo(map,f.data.lon,f.data.lat,18);};d.append(b,' ',go);L.appendChild(d);}}
renderFam(famL.fam);
const relay=connect(room,{onPresence:famL.update,onStatus:s=>$('famConn').textContent='('+s+')'});
window.__vw={fam:famL.fam,relay,famUpdate:famL.update};
if(new URLSearchParams(location.search).get('flights'))$('fltBtn').click();
// Chat tab is the home screen once you have an agent; the World tab is the map.
const hero=chatHero($('heroCv'));let tabs=null,autoChat=true;
const chat=setupChat({getAgent:()=>window.__vw.agent?.agent,getUser:currentUser,hero,onNeedAgent:()=>openSheet('agent'),
  onShowMe:a=>{tabs.set('world');if(a)flyTo(map,a.lon,a.lat,19);}});
tabs=setupTabs({map,hero,onSwitch:t=>{flt.pause(t==='chat');famL0.pause(t==='chat');},canChat:()=>!!window.__vw.agent?.agent&&chat.open(),onChat:()=>{const ok=chat.open();if(ok)closeSheet();return ok;}});
window.__vw.tabs=tabs;
// Onboarding for new users (?onb=0 skips it, for tests and debugging). Returning users go straight to Chat.
const noOnb=new URLSearchParams(location.search).get('onb')==='0';
const goChat=()=>{if(chat.open()){closeSheet();tabs.set('chat');}};
const ob=setupOnboarding(map,{onCreated:(a,saved)=>window.__vw.agent.adopt(a,saved),
  onDone:w=>{if(w==='move'){tabs.set('world');window.__vw.agent.startMove('onboarding');}else goChat();},
  onFindFriends:()=>{tabs.set('world');openSheet('family');}});
window.__vw.onb=ob;
onUser(u=>{if(!u&&!noOnb)ob.open(1);});
// Chat header: Show on map, and More (also ＋ in the composer) opens the agent sheet with Move my agent, Customise and live sharing.
const more=on=>{$('moreSheet').classList.toggle('on',on);$('moreScrim').classList.toggle('on',on);$('moreSheet').setAttribute('aria-hidden',String(!on));
  if(on){const a=window.__vw.agent?.agent;$('moreName').textContent=a?.name||'My agent';$('moreMono').textContent=(a?.name||'A')[0].toUpperCase();$('chatLive').setAttribute('aria-checked',String(watch!==null));}};
$('chatShow').onclick=()=>{const a=window.__vw.agent?.agent;tabs.set('world');if(a)flyTo(map,a.lon,a.lat,19);};
$('chatMore').onclick=$('chatPlus').onclick=()=>more(true);dragToClose($('moreSheet'),()=>more(false));$('moreDone').onclick=$('moreScrim').onclick=()=>more(false);
$('chatMove').onclick=()=>{more(false);tabs.set('world');window.__vw.agent.startMove('chat');};
$('chatCustom').onclick=()=>{more(false);tabs.set('world');openSheet('agent');$('agEdit')?.click();};
$('chatLive').onclick=()=>{$('liveBtn').click();$('chatLive').setAttribute('aria-checked',String(watch!==null));};
window.__vw.agent=setupAgent(map,{onLoaded:(u,a)=>{if(!u||noOnb)return;if(!a)ob.afterSignIn();else if(ob.active&&ob.step<=2){ob.close();goChat();}},onAgent:a=>{chat.reset();if(a&&autoChat){autoChat=false;if(chat.open()){closeSheet();tabs.set('chat');return true;}}else if(!a&&tabs.current==='chat')tabs.set('world');else if(a&&tabs.current==='chat')chat.open();}});
$('tabWorld').addEventListener('click',()=>{autoChat=false;});
// Share my own live location from inside the app, so the map (and my agent) stay on screen.
let watch=null,timer=null,lastPos=null;
const myName=()=>currentUser()?.displayName||localStorage.getItem('vw-name')||'Family member';
const sendPos=()=>{if(lastPos){usedKeys.add(myKey());relay.publish(myKey(),{name:myName(),...lastPos,ts:Date.now()});}};
const clearMe=()=>{for(const k of usedKeys)relay.clear(k);};
function stopLive(){if(watch!==null)navigator.geolocation.clearWatch(watch);clearInterval(timer);watch=timer=null;lastPos=null;clearMe();window.__vw.agent?.setLive(null);$('liveBtn').classList.remove('on');$('liveBtn').textContent='📡 Share my live location';}
$('liveBtn').onclick=()=>{if(watch!==null){stopLive();return toast('Stopped sharing');}
  if(!confirm('Share your live location with your family while the app is open?'))return;
  if(!currentUser()&&!localStorage.getItem('vw-name')){const n=prompt('Your name for the family map:');if(!n)return;localStorage.setItem('vw-name',n.slice(0,24));}
  watch=navigator.geolocation.watchPosition(p=>{const f=!lastPos;lastPos={lat:p.coords.latitude,lon:p.coords.longitude,acc:Math.round(p.coords.accuracy)};window.__vw.agent?.setLive(lastPos);
    if(f){sendPos();toast('📡 Sharing with family');if(window.__vw.agent?.agent){me?.remove();me=null;if(!map.getBounds().contains([lastPos.lon,lastPos.lat]))map.easeTo({center:[lastPos.lon,lastPos.lat],essential:true});}}},e=>{toast('Location error: '+e.message);stopLive();},{enableHighAccuracy:true,maximumAge:5000});
  timer=setInterval(sendPos,5000);$('liveBtn').classList.add('on');$('liveBtn').textContent='⛔ Stop sharing';};
addEventListener('pagehide',()=>{if(watch!==null)clearMe();});
if(new URLSearchParams(location.search).get('room'))setTimeout(()=>openSheet('family'),800);
// PWA
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('sw.js').catch(e=>console.warn('sw',e));
