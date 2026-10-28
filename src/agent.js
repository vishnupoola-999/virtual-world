import {reportSaveError} from './save-errors.js';
import {signIn,logOut,onUser,loadAgent,cachedAgent,cacheAgent,saveAgent,authMsg,redirectResult} from './firebase.js';
import {flyTo} from './map.js';
import {agentsOnMap} from './world-agents.js';
import {toLook,sanitize,ACCESSORIES,ACC_LABEL,BODY_SWATCHES,cleanColor} from './character-data.js';
import {toast} from './ui.js';
import {track} from './onboarding.js';
const $=id=>document.getElementById(id);
export function setupAgent(map,{onAgent=()=>{},onLoaded=()=>{}}={}){let user=null,agent=null,loadSeq=0,live=null;const av0=agentsOnMap(map).mine;
  // While live sharing (or after 📍), draw the character at the live position; the saved spot is not changed.
  const av={set:a=>av0.set(a&&live?{...a,lat:live.lat,lon:live.lon,status:'With you · sharing your live location'}:a&&{...a,meta:a.spotApprox?'Your agent · Home: approximate area':'Your agent · Only you see the exact spot'}),play:n=>av0.play(n)};const msg=t=>{$('agMsg').textContent=t;};
  const lk=lookEditor(l=>{if(agent&&$('agForm').dataset.edit)av.set({...agent,look:l});$('agSave').disabled=!lk?.picked();});
  const getPos=()=>new Promise((ok,no)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(ok,no,{enableHighAccuracy:true,timeout:20000}):no(new Error('Location not supported')));
  function render(){const signed=!!user;
    for(const id of ['signInBtn','agSignIn'])$(id).hidden=signed;$('userChip').hidden=!signed;$('agentBox').hidden=!signed;
    $('acctBtn').innerHTML='';if(signed&&user.photoURL){const i=new Image();i.src=user.photoURL;i.referrerPolicy='no-referrer';i.alt='';$('acctBtn').append(i);}else $('acctBtn').textContent=signed?(user.displayName||user.email||'?')[0].toUpperCase():'';$('acctBtn').classList.toggle('out',!signed);
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
  $('agMove').onclick=async()=>{msg('Getting your exact location…');try{const p=await getPos();agent=await saveAgent(user.uid,{...agent,ownerName:user.displayName||'',lat:p.coords.latitude,lon:p.coords.longitude,spotApprox:false});av.set(agent);go();msg(`Moved to where you are (±${Math.round(p.coords.accuracy)} m).`);}catch(e){msg(e?.code===1||e?.code===2||e?.code===3?'Could not get your location. Check location access and try again.':reportSaveError(e,'your agent'));}};
  $('agForm').onsubmit=async e=>{e.preventDefault();const base={name:$('agName').value.trim().slice(0,40),look:lk.value(),personality:$('agPers').value.trim().slice(0,300),ownerName:(user.displayName||'').slice(0,80)};
    if(!lk.picked())return msg('Tap a character first');if(!base.name)return msg('Give your agent a name');
    try{let lat=agent?.lat,lon=agent?.lon;if(!agent){msg('Asking for your location (only you see the exact spot)…');const p=await getPos();lat=p.coords.latitude;lon=p.coords.longitude;}
      agent=await saveAgent(user.uid,{...base,lat,lon,spotApprox:agent?.spotApprox});delete $('agForm').dataset.edit;av.set(agent);render();go();onAgent(agent);msg('Saved. Only you can see its exact spot.');}
    catch(e){const t=reportSaveError(e,'your look');msg(t);toast(t,6000);}};
  onUser(async u=>{endMove(false);const seq=++loadSeq;user=u;agent=null;delete $('agForm').dataset.edit;msg('');av.set(null);lk.load(null,u?.displayName||'');render();
    if(u){toast(`Signed in as ${u.displayName||u.email}`);
      // Show the last known agent straight away (no network), then confirm it from Firestore.
      const cached=cachedAgent(u.uid);if(cached){agent=cached;av.set(cached);render();}
      let fresh;for(let i=0;i<3&&seq===loadSeq;i++){try{fresh=await loadAgent(u.uid);if(seq!==loadSeq)return;agent=fresh;break;}
        catch(e){if(i===2){if(!cached)toast('Could not load your agent: '+(e.code||e.message),8000);}else await new Promise(r=>setTimeout(r,400*(i+1)));}}
      if(agent&&agent!==cached)av.set(agent);}
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
    saveAgent(user.uid,{...next,ownerName:user.displayName||''}).then(d=>{agent=d;toast('Your agent lives here now');}).catch(e=>{toast(reportSaveError(e,'the new spot'),8000);agent=prev;av.set(prev);});}
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
    adopt(a,quiet){const keepI=agent?.interests,keepB=agent?.bio;agent={...a};if(agent.interests==null&&keepI)agent.interests=keepI;if(agent.bio==null&&typeof keepB==='string')agent.bio=keepB;av.set(agent);render();if(!quiet)onAgent(a);},
    // Interests/bio saved from the sheet. Keeps the rest of the loaded agent and the local cache in sync.
    setProfile(p){if(!agent||!user||!p)return;agent={...agent,interests:Array.isArray(p.interests)?p.interests:agent.interests,bio:typeof p.bio==='string'?p.bio:(agent.bio||'')};cacheAgent(user.uid,agent);},
    _preview(a){agent=a;av.set(a);render();onAgent(a);}};}

// Creature look editor in the agent sheet. New agents start with nothing picked: the user taps one of six creature cards
// (thumbnails rendered from character.js, no labels) before Save is enabled, then may add one accessory.
// Existing agents open on their saved look (older human looks are migrated by toLook). Live-previews on the map when editing.
function lookEditor(onChange){let creature=null,acc='none',color=null;
  const accBox=$('lkAcc');accBox.innerHTML=ACCESSORIES.map(a=>`<button type="button" role="radio" data-acc="${a}" aria-checked="false">${ACC_LABEL[a]}</button>`).join('');
  // Colour row (design/body-colour): Default (the creature's own colour), eight hand-picked presets and a More swatch (native colour picker).
  const colBox=$('lkCol');colBox.innerHTML=`<button type="button" role="radio" class="swc def" data-col="" aria-label="Default colour" aria-checked="false"></button>`
    +BODY_SWATCHES.map((c,i)=>`<button type="button" role="radio" class="swc" data-col="${c}" style="--c:${c}" aria-label="Colour ${i+1}" aria-checked="false"></button>`).join('')
    +`<label class="swc cust" aria-label="More colours" title="More colours"><input type="color" id="lkColPick" value="#a99bff" aria-label="More colours"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg></label>`;
  const pick=$('lkColPick');let tt=0;
  const thumbsFor=()=>{if(!shown)return;clearTimeout(tt);tt=setTimeout(()=>import('./cards3d.js').then(m=>{const t=m.cardThumbs(color);for(const b of $('lkBase').querySelectorAll('button')){const img=b.querySelector('img');if(t[b.dataset.creature])img.src=t[b.dataset.creature];}}).catch(()=>{}),160);};
  function paint(){$('lkBase').classList.toggle('chosen',!!creature);
    for(const b of colBox.querySelectorAll('button')){const on=(b.dataset.col||null)===color;b.classList.toggle('on',on);b.setAttribute('aria-checked',String(on));}
    const custom=!!color&&!BODY_SWATCHES.includes(color);const cl=colBox.querySelector('.cust');cl.classList.toggle('on',custom);if(custom){cl.style.setProperty('--c',color);pick.value=color;}else cl.style.removeProperty('--c');
    for(const b of $('lkBase').querySelectorAll('button')){const on=b.dataset.creature===creature;b.classList.toggle('on',on);b.setAttribute('aria-checked',String(on));}
    for(const b of accBox.querySelectorAll('button')){const on=b.dataset.acc===acc;b.classList.toggle('on',on);b.setAttribute('aria-checked',String(on));}
    $('lkMore').hidden=!creature;onChange(value());}
  for(const b of $('lkBase').querySelectorAll('button'))b.onclick=()=>{creature=b.dataset.creature;paint();};
  for(const b of accBox.querySelectorAll('button'))b.onclick=()=>{acc=b.dataset.acc;paint();};
  const setCol=c=>{const n=cleanColor(c);if(n===color)return;color=n;paint();thumbsFor();};
  for(const b of colBox.querySelectorAll('button'))b.onclick=()=>setCol(b.dataset.col);
  pick.oninput=()=>setCol(pick.value);
  let shown=false;const showThumbs=()=>{if(shown)return;shown=true;import('./cards3d.js').then(m=>{const t=m.cardThumbs();for(const b of $('lkBase').querySelectorAll('button')){const img=b.querySelector('img');if(t[b.dataset.creature])img.src=t[b.dataset.creature];}if(color)thumbsFor();}).catch(e=>console.warn('picker thumbs',e?.message));};
  new IntersectionObserver(es=>{if(es.some(e=>e.isIntersecting))showThumbs();}).observe($('lkBase'));
  function value(){return creature?sanitize({creature,accessory:acc,color}):null;}
  return {value,picked:()=>!!creature,load(look,name){creature=null;acc='none';const was=color;color=null;
    if(look){const l=toLook(look,name);creature=l.creature;acc=l.accessory;color=l.color||null;}
    paint();if(was!==color)thumbsFor();}};}
// three.js (~267 KB gz) is only fetched once there is an agent to draw and the map is zoomed in far enough to see it (perf audit #2).
