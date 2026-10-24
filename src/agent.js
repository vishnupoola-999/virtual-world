import {signIn,logOut,onUser,loadAgent,saveAgent,authMsg,redirectResult} from './firebase.js';
import {flyTo} from './map.js';
import {toLook,defaultLook,sanitize,SKIN,HAIR_COLOURS,OUTFIT_COLOURS,HAIRSTYLES,OUTFITS,ACCESSORIES} from './character-data.js';
import {toast} from './ui.js';
import {track} from './onboarding.js';
const $=id=>document.getElementById(id);
export function setupAgent(map,{onAgent=()=>{},onLoaded=()=>{}}={}){let user=null,agent=null,loadSeq=0,live=null;const av0=lazyAvatar(map);
  // While live sharing (or after 📍), draw the character at the live position; the saved spot is not changed.
  const av={set:a=>av0.set(a&&live?{...a,lat:live.lat,lon:live.lon}:a),play:n=>av0.play(n)};const msg=t=>{$('agMsg').textContent=t;};
  const lk=lookEditor(l=>{if(agent&&$('agForm').dataset.edit)av.set({...agent,look:l});$('agSave').disabled=!lk?.picked();});
  const getPos=()=>new Promise((ok,no)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(ok,no,{enableHighAccuracy:true,timeout:20000}):no(new Error('Location not supported')));
  function render(){const signed=!!user;
    for(const id of ['signInBtn','agSignIn'])$(id).hidden=signed;$('userChip').hidden=!signed;$('agentBox').hidden=!signed;
    $('acctBtn').innerHTML='';if(signed&&user.photoURL){const i=new Image();i.src=user.photoURL;i.referrerPolicy='no-referrer';i.alt='';$('acctBtn').append(i);}else $('acctBtn').textContent='👤';
    if(signed){$('userName').textContent=user.displayName||user.email;$('userMail').textContent=user.email||'';}
    $('agForm').hidden=!signed||!!agent&&!$('agForm').dataset.edit;$('agView').hidden=!agent||!$('agForm').hidden;
    if(agent){$('agTitle').textContent=agent.name;$('agDesc').textContent=agent.personality||'';}
    $('agSave').textContent=agent?'Save':'Create my agent here';$('agSave').disabled=!lk.picked();}
  const doSignIn=()=>signIn().catch(e=>{console.warn('signIn',e.code);toast(authMsg(e),8000);});
  $('signInBtn').onclick=doSignIn;$('agSignIn').onclick=doSignIn;
  redirectResult.catch(e=>toast(authMsg(e),8000));
  $('signOutBtn').onclick=()=>logOut().then(()=>toast('Signed out'));
  // Leaving the look editor without saving puts the saved look back on the map.
  document.addEventListener('vw-agent-sheet-leave',()=>{if(!$('agForm').dataset.edit)return;delete $('agForm').dataset.edit;if(agent)av.set(agent);render();});
  $('agEdit').onclick=()=>{$('agForm').dataset.edit=1;$('agName').value=agent.name;lk.load(agent.look,agent.ownerName||user.displayName||agent.name);$('agPers').value=agent.personality||'';render();};
  const go=()=>{if(agent)flyTo(map,agent.lon,agent.lat,19);};$('agGo').onclick=go;
  $('agMove').onclick=async()=>{msg('Getting your exact location…');try{const p=await getPos();agent=await saveAgent(user.uid,{...agent,ownerName:user.displayName||'',lat:p.coords.latitude,lon:p.coords.longitude,spotApprox:false});av.set(agent);go();msg(`Moved to where you are (±${Math.round(p.coords.accuracy)} m).`);}catch(e){msg('Error: '+(e.code||e.message));}};
  $('agForm').onsubmit=async e=>{e.preventDefault();const base={name:$('agName').value.trim().slice(0,40),look:lk.value(),personality:$('agPers').value.trim().slice(0,300),ownerName:(user.displayName||'').slice(0,80)};
    if(!lk.picked())return msg('Tap a character first');if(!base.name)return msg('Give your agent a name');
    try{let lat=agent?.lat,lon=agent?.lon;if(!agent){msg('Asking for your location (only you see the exact spot)…');const p=await getPos();lat=p.coords.latitude;lon=p.coords.longitude;}
      agent=await saveAgent(user.uid,{...base,lat,lon,spotApprox:agent?.spotApprox});delete $('agForm').dataset.edit;av.set(agent);render();go();onAgent(agent);msg('Saved. Only you can see its exact spot.');}
    catch(e){msg('Error: '+(e.code||e.message));}};
  onUser(async u=>{endMove(false);const seq=++loadSeq;user=u;agent=null;delete $('agForm').dataset.edit;msg('');av.set(null);lk.load(null,u?.displayName||'');render();
    if(u){toast(`Signed in as ${u.displayName||u.email}`);
      for(let i=0;i<3&&seq===loadSeq;i++){try{const a=await loadAgent(u.uid);if(seq!==loadSeq)return;agent=a;break;}
        catch(e){if(i===2)toast('Could not load your agent: '+(e.code||e.message),8000);else await new Promise(r=>setTimeout(r,1500*(i+1)));}}
      if(agent)av.set(agent);}
    render();if(seq!==loadSeq)return;
    // Opening on the Chat tab: skip the fly-to (the map is hidden); it happens from Show me instead.
    onLoaded(user,agent);if(!onAgent(agent)&&agent)go();});
  // Move my agent: lift it (pin raised 12 px with a shadow at the map centre), drag the map, confirm "My agent lives here".
  let moving=null;
  function startMove(from){if(!agent||moving)return;track('move_agent_tap',{from});moving={from};document.dispatchEvent(new Event('vw-agent-sheet-leave'));
    document.body.classList.add('moving');$('moveBar').hidden=false;map.flyTo({center:[agent.lon,agent.lat],zoom:Math.max(map.getZoom(),17.5),essential:true});av.set(null);}
  function endMove(save){if(!moving)return;if(!user||!agent)save=false;const prev=agent;moving=null;document.body.classList.remove('moving');$('moveBar').hidden=true;
    if(!save){if(prev)av.set(prev);return;}const c=map.getCenter();const approxBefore=!!prev.spotApprox;
    const next={...prev,lat:c.lat,lon:c.lng,spotApprox:false};agent=next;av.set(next);av.play?.('walk');setTimeout(()=>av.play?.('idle'),900);
    track('move_agent_done',{approx_before:approxBefore});
    saveAgent(user.uid,{...next,ownerName:user.displayName||''}).then(d=>{agent=d;toast('Your agent lives here now');}).catch(e=>{toast('Could not move: '+(e.code||e.message),8000);agent=prev;av.set(prev);});}
  $('agLift').onclick=()=>startMove('sheet');$('moveOk').onclick=()=>endMove(true);$('moveCancel').onclick=()=>endMove(false);
  // Long-press (500 ms) on your own agent on the World map.
  let lp=0,lpAt=null;const cancelLp=()=>{clearTimeout(lp);lp=0;};
  map.on('touchstart',e=>{if(e.points?.length!==1)return cancelLp();press(e.point);});map.on('mousedown',e=>press(e.point));
  function press(pt){cancelLp();if(!agent||moving)return;const q=map.project([agent.lon,agent.lat]);if(Math.hypot(q.x-pt.x,(q.y-30)-pt.y)>48)return;lpAt=pt;lp=setTimeout(()=>{lp=0;navigator.vibrate?.(20);startMove('longpress');},500);}
  for(const ev of ['touchend','mouseup','dragstart','zoomstart'])map.on(ev,cancelLp);
  map.on('touchmove',e=>{if(lpAt&&Math.hypot(e.point.x-lpAt.x,e.point.y-lpAt.y)>10)cancelLp();});
  render();lk.load(null,'');return {get agent(){return agent;},startMove,
    // Live position for the on-map character (null = back to the saved spot). Returns true when a character is drawn there.
    setLive(p){live=p&&isFinite(p.lat)&&isFinite(p.lon)?{lat:p.lat,lon:p.lon}:null;if(!moving)av.set(agent);return !!agent;},
    // Agent created by onboarding (local copy first, then the saved one).
    adopt(a,quiet){agent=a;av.set(a);render();if(!quiet)onAgent(a);},
    _preview(a){agent=a;av.set(a);render();onAgent(a);}};}

// Character look editor in the agent sheet. New agents start with nothing picked and no name-based guess: the user taps one
// of two character cards (rendered from character.js) before Save is enabled. Existing agents open on their saved look.
// Each base keeps its own edits. Live-previews on the map character when editing.
const LABEL={none:'None',glasses:'Glasses',headphones:'Headphones',cap:'Cap',bindi:'Bindi'};
function lookEditor(onChange){let per={},base=null;
  const cur=()=>per[base]||(per[base]=defaultLook(base));
  const swatches=(id,list,key)=>{const el=$(id);el.innerHTML='';for(const c of list){const b=document.createElement('button');b.type='button';b.style.background=c;b.ariaLabel=c;b.dataset.c=c;
    b.onclick=()=>{if(!base)return;cur()[key]=c;paint();};el.append(b);}};
  const opts=(id,list)=>{const el=$(id);el.innerHTML='';for(const v of list){const o=document.createElement('option');o.value=v;o.textContent=v[0].toUpperCase()+v.slice(1);el.append(o);}};
  function paint(){$('lkBase').classList.toggle('chosen',!!base);
    for(const b of $('lkBase').querySelectorAll('button')){const on=b.dataset.base===base;b.classList.toggle('on',on);b.setAttribute('aria-checked',String(on));}
    $('lkMore').hidden=!base;if(!base){onChange(null);return;}
    const l=cur();opts('lkHair',HAIRSTYLES[base]);opts('lkOutfit',OUTFITS[base]);$('lkHair').value=l.hair;$('lkOutfit').value=l.outfit;
    for(const [id,key] of [['lkSkin','skin'],['lkHairC','hairColour'],['lkOutfitC','outfitColour']])for(const b of $(id).children)b.classList.toggle('on',b.dataset.c===l[key]);
    const acc=$('lkAcc');acc.innerHTML='';for(const a of ACCESSORIES[base].filter(a=>a!=='none')){const lb=document.createElement('label'),i=document.createElement('input');i.type='checkbox';i.checked=l.acc.includes(a);
      i.onchange=()=>{l.acc=i.checked?[...new Set([...l.acc,a])]:l.acc.filter(x=>x!==a);onChange(value());};lb.append(i,' '+LABEL[a]);acc.append(lb);}
    onChange(value());}
  swatches('lkSkin',SKIN,'skin');swatches('lkHairC',HAIR_COLOURS,'hairColour');swatches('lkOutfitC',OUTFIT_COLOURS,'outfitColour');
  $('lkHair').onchange=()=>{cur().hair=$('lkHair').value;paint();};$('lkOutfit').onchange=()=>{cur().outfit=$('lkOutfit').value;paint();};
  for(const b of $('lkBase').querySelectorAll('button'))b.onclick=()=>{base=b.dataset.base;paint();};
  let shown=false;const showThumbs=()=>{if(shown)return;shown=true;import('./cards3d.js').then(m=>{const t=m.cardThumbs();for(const b of $('lkBase').querySelectorAll('button')){const img=b.querySelector('img');if(t[b.dataset.base])img.src=t[b.dataset.base];}}).catch(e=>console.warn('picker thumbs',e?.message));};
  new IntersectionObserver(es=>{if(es.some(e=>e.isIntersecting))showThumbs();}).observe($('lkBase'));
  function value(){return base?sanitize({...cur(),v:1,base}):null;}
  return {value,picked:()=>!!base,load(look,name){per={};base=null;
    if(look){const l=toLook(look,name);base=l.base;per[base]=l;}
    paint();}};}
// three.js (~267 KB gz) is only fetched once there is an agent to draw and the map is zoomed in far enough to see it (perf audit #2).
function lazyAvatar(map){let real=null,last=null,loading=null,waiting=false;
  const load=()=>loading||=import('./avatar3d.js').then(m=>{real=m.avatarLayer(map);real.set(last);window.__three3d=true;return real;}).catch(e=>{loading=null;console.warn('avatar3d',e?.message);});
  const onZoom=()=>{if(map.getZoom()>=10){map.off('zoom',onZoom);waiting=false;load();}};
  const want=()=>{if(loading)return;if(map.getZoom()>=10||document.body.dataset.tab==='chat')load();else if(!waiting){waiting=true;map.on('zoom',onZoom);}};
  return {set(a){last=a;if(real)real.set(a);else if(a)want();},play(n){real?.play(n);}};}
