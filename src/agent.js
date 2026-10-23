import {signIn,logOut,onUser,loadAgent,saveAgent,authMsg,redirectResult} from './firebase.js';
import {flyTo} from './map.js';
import {avatarLayer} from './avatar3d.js';
import {toast,openSheet} from './ui.js';
const $=id=>document.getElementById(id);
export function setupAgent(map){let user=null,agent=null,loadSeq=0;const av=avatarLayer(map);const msg=t=>{$('agMsg').textContent=t;};
  const getPos=()=>new Promise((ok,no)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(ok,no,{enableHighAccuracy:true,timeout:20000}):no(new Error('Location not supported')));
  function render(){const signed=!!user;
    for(const id of ['signInBtn','agSignIn'])$(id).hidden=signed;$('userChip').hidden=!signed;$('agentBox').hidden=!signed;
    $('acctBtn').innerHTML='';if(signed&&user.photoURL){const i=new Image();i.src=user.photoURL;i.referrerPolicy='no-referrer';i.alt='';$('acctBtn').append(i);}else $('acctBtn').textContent='👤';
    if(signed){$('userName').textContent=user.displayName||user.email;$('userMail').textContent=user.email||'';}
    $('agForm').hidden=!signed||!!agent&&!$('agForm').dataset.edit;$('agView').hidden=!agent||!$('agForm').hidden;
    if(agent){$('agTitle').textContent=agent.look.emoji+' '+agent.name;$('agDesc').textContent=agent.personality||'';}
    $('agSave').textContent=agent?'💾 Save':'✨ Create my agent here';}
  const doSignIn=()=>signIn().catch(e=>{console.warn('signIn',e.code);toast('⚠️ '+authMsg(e),8000);});
  $('signInBtn').onclick=doSignIn;$('agSignIn').onclick=doSignIn;
  redirectResult.catch(e=>toast('⚠️ '+authMsg(e),8000));
  $('signOutBtn').onclick=()=>logOut().then(()=>toast('Signed out'));
  $('agEdit').onclick=()=>{$('agForm').dataset.edit=1;$('agName').value=agent.name;$('agColor').value=agent.look.color;$('agEmoji').value=agent.look.emoji;$('agPers').value=agent.personality||'';render();};
  const go=()=>{if(agent)flyTo(map,agent.lon,agent.lat,19);};$('agGo').onclick=go;
  $('agMove').onclick=async()=>{msg('Getting your exact location…');try{const p=await getPos();agent=await saveAgent(user.uid,{...agent,ownerName:user.displayName||'',lat:p.coords.latitude,lon:p.coords.longitude});av.set(agent);go();msg(`Moved to where you are (±${Math.round(p.coords.accuracy)} m).`);}catch(e){msg('Error: '+(e.code||e.message));}};
  $('agForm').onsubmit=async e=>{e.preventDefault();const base={name:$('agName').value.trim().slice(0,40),look:{color:$('agColor').value,emoji:[...$('agEmoji').value.trim()].slice(0,2).join('')||'🤖'},personality:$('agPers').value.trim().slice(0,300),ownerName:(user.displayName||'').slice(0,80)};
    if(!base.name)return msg('Give your agent a name');
    try{let lat=agent?.lat,lon=agent?.lon;if(!agent){msg('Asking for your location (only you see the exact spot)…');const p=await getPos();lat=p.coords.latitude;lon=p.coords.longitude;}
      agent=await saveAgent(user.uid,{...base,lat,lon});delete $('agForm').dataset.edit;av.set(agent);render();go();msg('✅ Saved. Only you can see its exact spot.');}
    catch(e){msg('Error: '+(e.code||e.message));}};
  onUser(async u=>{const seq=++loadSeq;user=u;agent=null;delete $('agForm').dataset.edit;msg('');av.set(null);render();
    if(u){toast(`Signed in as ${u.displayName||u.email}`);
      for(let i=0;i<3&&seq===loadSeq;i++){try{const a=await loadAgent(u.uid);if(seq!==loadSeq)return;agent=a;break;}
        catch(e){if(i===2)toast('⚠️ Could not load your agent: '+(e.code||e.message),8000);else await new Promise(r=>setTimeout(r,1500*(i+1)));}}
      if(agent){av.set(agent);go();}}
    render();});
  render();return {get agent(){return agent;},_preview(a){agent=a;av.set(a);render();}};}
