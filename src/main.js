import {createMap,flyTo,search,HOME} from './map.js';
import {connect,roomFromUrl,joinLink} from './family.js';
import {familyLayer} from './family-layer.js';
import {agentsOnMap} from './world-agents.js';
import {flightsLayer} from './flights.js';
import {setupAgent} from './agent.js';
import {setupOnboarding} from './onboarding.js';
import {setupChat} from './chat.js';
import {chatHero} from './chat-hero.js';
import {setupTabs} from './tabs.js';
import {currentUser,onUser,loadDiary} from './firebase.js';
import {setupLiving,readStatus} from './living.js';
import {setupAway,markVisit} from './away.js';
import {setupTown} from './town.js';
import {track} from './onboarding.js';
import {setupUI,toast,closeSheet,openSheet,dragToClose} from './ui.js';
const $=id=>document.getElementById(id);
setupUI();
const map=createMap('map',{onToast:t=>toast(t)});window.__map=map;
const agents=agentsOnMap(map);
map.on('error',e=>console.warn('map:',e.error?.message||e));
// search
$('searchF').onsubmit=async e=>{e.preventDefault();const q=$('q').value.trim();if(!q)return;$('results').textContent='Searching…';
  try{const rs=await search(q);$('results').innerHTML='';if(!rs.length)$('results').textContent='No results';
    for(const r of rs){const d=document.createElement('div');d.textContent=r.display_name;d.onclick=()=>{flyTo(map,+r.lon,+r.lat,r.type==='city'||r.addresstype==='city'?14:17);$('results').innerHTML='';$('q').blur();closeSheet();};$('results').appendChild(d);}}
  catch(err){$('results').textContent='Search failed: '+err.message;}};
// my location (opt-in, stays in this browser)
let me=null;
// Recenter: fly to your agent (where it is drawn, i.e. your live spot while sharing); without an agent, find my location.
$('meBtn').onclick=()=>{const mine=agents.get('me');if(mine){const ll=mine.marker.getLngLat();map.easeTo({center:ll,zoom:Math.max(map.getZoom(),17),duration:600,essential:true});return;}locateMe();};
const locateMe=()=>{if(!navigator.geolocation)return toast('Location not supported');toast('Asking for location…',0);
  navigator.geolocation.getCurrentPosition(p=>{const ll=[p.coords.longitude,p.coords.latitude];
    // With an agent, the character itself stands at your position; the plain dot is only for people without one.
    if(window.__vw.agent?.setLive({lat:ll[1],lon:ll[0]})){me?.remove();me=null;}
    else if(!me){const el=document.createElement('div');el.className='me';me=new maplibregl.Marker({element:el}).setLngLat(ll).addTo(map);}else me.setLngLat(ll);
    flyTo(map,...ll,18);toast(`You are here (±${Math.round(p.coords.accuracy)} m). Not shared.`);},e=>toast('Location error: '+e.message),{enableHighAccuracy:true,timeout:20000});};
$('homeBtn').onclick=()=>{closeSheet();map.flyTo({center:[HOME.lng,HOME.lat],zoom:16.3,pitch:60,bearing:-20});};
$('globeBtn').onclick=()=>{closeSheet();map.flyTo({zoom:1.6,pitch:0,bearing:0});};
// flights
const flt=flightsLayer(map,{onMsg:t=>$('fltMsg').textContent=t,getUser:currentUser});
$('swFlights').onclick=()=>{const on=flt.toggle();$('swFlights').setAttribute('aria-checked',String(on));toast(on?'Flights on':'Flights off');};
// family
const room=roomFromUrl();
$('shareBtn').onclick=async()=>{const l=joinLink(room);try{if(navigator.share)await navigator.share({title:'Join our Virtual World',url:l});else await navigator.clipboard.writeText(l);$('shareMsg').textContent='Link copied. Send it only to family.';}catch{prompt('Copy this link and send it to family:',l);}};
const myId=localStorage.getItem('vw-me')||crypto.randomUUID().slice(0,12);localStorage.setItem('vw-me',myId);
const famL0=familyLayer(map,{onChange:renderFam});const myKey=()=>currentUser()?.uid||myId;const usedKeys=new Set([myId]);const famL={fam:famL0.fam,update:d=>{if(d.id!==myId&&d.id!==myKey())famL0.update(d);}};
// When sign-in restores, drop my own dot if a relay update arrived before we knew who I am.
onUser(u=>{if(u){usedKeys.add(u.uid);if(famL0.fam.has(u.uid))famL0.update({id:u.uid,stop:true});}});
function renderFam(fam){$('famN').textContent=fam.size||'';$('famN2').textContent=fam.size;const L=$('famList');L.innerHTML='';
  for(const f of fam.values()){const d=document.createElement('div');d.className='famItem';const b=document.createElement('b');b.textContent=f.data.name||'Family';
    const go=document.createElement('button');go.textContent='Go to';go.onclick=()=>{closeSheet();flyTo(map,f.data.lon,f.data.lat,18);};d.append(b,' ',go);L.appendChild(d);}}
renderFam(famL.fam);
const relay=connect(room,{onPresence:famL.update,onStatus:s=>$('famConn').textContent='('+s+')'});
window.__vw={fam:famL.fam,relay,famUpdate:famL.update,agents};
if(new URLSearchParams(location.search).get('flights'))$('swFlights').click();
// Chat tab is the home screen once you have an agent; the World tab is the map.
// Your agent's marker mirrors the chat: thinking shows the busy ring, a reply shows the talking bubble.
const hero0=chatHero($('heroCv'));const hero={...hero0,state(s){hero0.state(s);agents.setState('me',s==='thinking'||s==='sleeping'?'busy':s==='talking'?'talking':'online');if(s==='talking')setTimeout(()=>agents.setState('me','online'),2500);}};let tabs=null,autoChat=true;
const chat=setupChat({getAgent:()=>window.__vw.agent?.agent,getUser:currentUser,hero,onNeedAgent:()=>openSheet('agent'),
  onShowMe:a=>{tabs.set('world');if(a)flyTo(map,a.lon,a.lat,19);}});
tabs=setupTabs({map,hero,onSwitch:t=>{flt.pause(t==='chat');famL0.pause(t==='chat');},canChat:()=>!!window.__vw.agent?.agent&&chat.open(),onChat:()=>{const ok=chat.open();if(ok)closeSheet();return ok;}});
window.__vw.tabs=tabs;
// Onboarding for new users (?onb=0 skips it, for tests and debugging). Returning users go straight to Chat.
const noOnb=new URLSearchParams(location.search).get('onb')==='0';
const goChat=()=>{if(chat.open()){closeSheet();tabs.set('chat');}};
const ob=setupOnboarding(map,{onCreated:(a,saved)=>window.__vw.agent.adopt(a,saved),
  onInterests:p=>window.__vw.agent.setProfile(p),
  onDone:w=>{if(w==='move'){tabs.set('world');window.__vw.agent.startMove('onboarding');}else goChat();},
  onFindFriends:()=>{tabs.set('world');openSheet('family');}});
window.__vw.onb=ob;
onUser(u=>{if(!u&&!noOnb)ob.open(1);});
// Chat header: Show on map, and More (also ＋ in the composer) opens the agent sheet with Move my agent, Customise and live sharing.
const more=on=>{$('moreSheet').classList.toggle('on',on);$('moreScrim').classList.toggle('on',on);$('moreSheet').setAttribute('aria-hidden',String(!on));
  if(on){const a=window.__vw.agent?.agent;$('moreName').textContent=a?.name||'My agent';$('moreMono').textContent=(a?.name||'A')[0].toUpperCase();$('chatLive').setAttribute('aria-checked',String(watch!==null));}};
// World v2: rail, Layers, profile sheet actions.
$('railMe').onclick=()=>{const mine=agents.get('me');if(mine){closeSheet();agents.openProfile(mine);}else openSheet('agent');};
$('layDone').onclick=()=>closeSheet();
$('swFriends').onclick=()=>{const on=$('swFriends').getAttribute('aria-checked')!=='true';$('swFriends').setAttribute('aria-checked',String(on));agents.showFriends(on);toast(on?"Friends' agents shown":"Friends' agents hidden");};
agents.configure({onmove:()=>window.__vw.agent.startMove('profile'),oncustom:()=>{openSheet('agent');$('agEdit')?.click();},
  oninterests:()=>ob.editInterests(window.__vw.agent?.agent),
  onvisit:a=>{const ll=a.marker.getLngLat();flyTo(map,ll.lng,ll.lat,18);},onchat:a=>toast(`Chatting with ${a.name}'s agent is coming soon`),
  onLongPress:()=>window.__vw.agent.startMove('longpress')});
$('chatShow').onclick=()=>{const a=window.__vw.agent?.agent;tabs.set('world');if(a)flyTo(map,a.lon,a.lat,19);};
$('chatMore').onclick=$('chatPlus').onclick=()=>more(true);dragToClose($('moreSheet'),()=>more(false));$('moreDone').onclick=$('moreScrim').onclick=()=>more(false);
$('chatMove').onclick=()=>{more(false);tabs.set('world');window.__vw.agent.startMove('chat');};
$('chatCustom').onclick=()=>{more(false);tabs.set('world');openSheet('agent');$('agEdit')?.click();};
$('chatInterests').onclick=()=>{more(false);ob.editInterests(window.__vw.agent?.agent);};
$('chatLive').onclick=()=>{$('liveBtn').click();$('chatLive').setAttribute('aria-checked',String(watch!==null));};
// Living agents: status pill / route / link / hint card on the map, and the "While you were away" card on open.
// V1 (friends test): map walking/meeting/working states, status pill and hint card are off. Flip after V1.
const LIVING_MAP=true;
const living=LIVING_MAP?setupLiving(map,{hintEl:$('liveHint')}):{showOwn:a=>readStatus(a),readStatus};const away=setupAway({track});window.__vw.living=living;window.__vw.away=away;
// Other people's public agents on the map + the Feed sheet (signed-in, non-anonymous users only).
const town=setupTown({agents,living,map,getUser:currentUser,el:$('feedList'),actEl:$('agentChats'),dotEl:$('agentDot')});window.__vw.town=town;
// Ambient creatures across the world's cities (client-only, deterministic, no names).
import('./ambient.js').then(m=>{window.__vw.ambient=m.setupAmbient(map,agents);}).catch(e=>console.warn('ambient',e?.message));
onUser(u=>{if(u&&!u.isAnonymous){town.refreshMap(u);town.checkUnread(u);}else town.clearMap();});setInterval(()=>{if(!document.hidden)town.refreshMap();},120000);
$('railFeed').addEventListener('click',()=>town.loadFeed());
// Agent chats (rail): the agent's own log + worth-meeting notes. Opening it clears the unread dot.
$('railAgent').addEventListener('click',()=>town.loadActivity());
addEventListener('pagehide',()=>markVisit());document.addEventListener('visibilitychange',()=>{if(document.hidden&&!away.open)markVisit();});
const showLife=(u,a)=>{living.showOwn(a);if(!u||!a||ob.active)return;loadDiary(u.uid).then(entries=>away.maybeShow({name:a.name,entries})).catch(e=>console.warn('diary',e?.code||e?.message));};
window.__vw.agent=setupAgent(map,{onLoaded:(u,a)=>{
  // Ask for interests whenever a signed-in agent has fewer than 3 tags stored in Firestore.
  // ?onb=0 still skips the first-time tour, but not this prompt. Don't interrupt onboarding past sign-in.
  const returningMidIntro=!!(u&&a&&ob.active&&ob.step<=2);
  if(u&&!a&&!noOnb)ob.afterSignIn();
  else if(returningMidIntro)ob.close();
  const asking=!!(u&&a&&!ob.active&&ob.promptIfNeeded(a));
  showLife(u,a);
  if(returningMidIntro&&!asking)goChat();
},onAgent:a=>{chat.reset();if(a&&autoChat){autoChat=false;if(chat.open()){closeSheet();tabs.set('chat');return true;}}else if(!a&&tabs.current==='chat')tabs.set('world');else if(a&&tabs.current==='chat')chat.open();}});
$('tabWorld').addEventListener('click',()=>{autoChat=false;});
// Share my own live location from inside the app, so the map (and my agent) stay on screen.
let watch=null,timer=null,lastPos=null;
const myName=()=>currentUser()?.displayName||localStorage.getItem('vw-name')||'Family member';
// One dot per person: once signed in, retire any key this device used before (anon device id) so viewers drop it now, not after STALE_MS.
const retired=new Set();const sendPos=()=>{if(lastPos){const k=myKey();usedKeys.add(k);for(const o of usedKeys)if(o!==k&&!retired.has(o)){retired.add(o);relay.clear(o);}relay.publish(k,{name:myName(),uid:currentUser()?.uid||undefined,...lastPos,ts:Date.now()});}};
const clearMe=()=>{for(const k of usedKeys)relay.clear(k);};
function stopLive(){if(watch!==null)navigator.geolocation.clearWatch(watch);clearInterval(timer);watch=timer=null;lastPos=null;clearMe();window.__vw.agent?.setLive(null);$('liveBtn').classList.remove('on');$('liveBtn').textContent='Share my live location';}
$('liveBtn').onclick=()=>{if(watch!==null){stopLive();return toast('Stopped sharing');}
  if(!confirm('Share your live location with your family while the app is open?'))return;
  if(!currentUser()&&!localStorage.getItem('vw-name')){const n=prompt('Your name for the family map:');if(!n)return;localStorage.setItem('vw-name',n.slice(0,24));}
  watch=navigator.geolocation.watchPosition(p=>{const f=!lastPos;lastPos={lat:p.coords.latitude,lon:p.coords.longitude,acc:Math.round(p.coords.accuracy)};window.__vw.agent?.setLive(lastPos);
    if(f){sendPos();toast('Sharing with family');if(window.__vw.agent?.agent){me?.remove();me=null;if(!map.getBounds().contains([lastPos.lon,lastPos.lat]))map.easeTo({center:[lastPos.lon,lastPos.lat],essential:true});}}},e=>{toast('Location error: '+e.message);stopLive();},{enableHighAccuracy:true,maximumAge:5000});
  timer=setInterval(sendPos,5000);$('liveBtn').classList.add('on');$('liveBtn').textContent='Stop sharing';};
addEventListener('pagehide',()=>{if(watch!==null)clearMe();});
if(new URLSearchParams(location.search).get('room'))setTimeout(()=>openSheet('family'),800);
// PWA
if('serviceWorker' in navigator&&location.protocol==='https:'){const hadSW=!!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).then(r=>{r.update?.();document.addEventListener('visibilitychange',()=>{if(!document.hidden)r.update?.().catch(()=>{});});}).catch(e=>console.warn('sw',e));
  // A new version took over (skipWaiting + clients.claim in sw.js): offer one tap to load it, so old JS never lingers in an open tab.
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!hadSW||window.__vwReloadOffered)return;window.__vwReloadOffered=true;showUpdate();});}
function showUpdate(){const b=document.createElement('button');b.id='updBar';b.type='button';b.textContent='A new version is ready. Tap to refresh.';b.onclick=()=>location.reload();document.body.append(b);}

// Keep-warm: the Render proxy sleeps when idle (30-60 s cold start). Wake it on app open so the first chat reply is not slow.
// Not on the agent's path; fire-and-forget.
fetch('https://virtual-world-ai.onrender.com/',{mode:'no-cors',cache:'no-store'}).catch(()=>{});
