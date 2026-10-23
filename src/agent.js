import {signIn,logOut,onUser,loadAgent,saveAgent} from './firebase.js';
import {flyTo} from './map.js';
const $=id=>document.getElementById(id);
export function setupAgent(map){let user=null,agent=null,marker=null;const msg=t=>$('agMsg').textContent=t;
  const getPos=()=>new Promise((ok,no)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(ok,no,{enableHighAccuracy:true,timeout:20000}):no(new Error('Location not supported')));
  function draw(){if(!agent){marker?.remove();marker=null;return;}
    const el=document.createElement('div');el.className='fam agent';const av=document.createElement('div');av.className='av';av.style.background=agent.look.color;av.textContent=agent.look.emoji;
    const nm=document.createElement('div');nm.className='nm';nm.textContent=agent.name+' (your agent)';el.append(av,nm);
    marker?.remove();marker=new maplibregl.Marker({element:el,anchor:'bottom'}).setLngLat([agent.lon,agent.lat]).addTo(map);}
  function render(){const signed=!!user;$('signInBtn').hidden=signed;$('userChip').hidden=!signed;$('agentBox').hidden=!signed;
    if(signed){$('userName').textContent=user.displayName||user.email;$('userPic').src=user.photoURL||'favicon.svg';}
    $('agForm').hidden=!signed||!!agent&&!$('agForm').dataset.edit;$('agView').hidden=!agent||!$('agForm').hidden;
    if(agent){$('agTitle').textContent=agent.look.emoji+' '+agent.name;$('agDesc').textContent=agent.personality||'';}
    $('agSave').textContent=agent?'💾 Save':'✨ Create my agent (uses your location)';}
  $('signInBtn').onclick=()=>signIn().catch(e=>msg('Sign-in failed: '+(e.code||e.message)));
  $('signOutBtn').onclick=()=>logOut();
  $('agEdit').onclick=()=>{$('agForm').dataset.edit=1;$('agName').value=agent.name;$('agColor').value=agent.look.color;$('agEmoji').value=agent.look.emoji;$('agPers').value=agent.personality;render();};
  $('agGo').onclick=()=>flyTo(map,agent.lon,agent.lat,18);
  $('agMove').onclick=async()=>{msg('Getting your exact location…');try{const p=await getPos();agent=await saveAgent(user.uid,{...agent,ownerName:user.displayName||'',lat:p.coords.latitude,lon:p.coords.longitude});draw();flyTo(map,agent.lon,agent.lat,18);msg(`Moved to where you are (±${Math.round(p.coords.accuracy)} m).`);}catch(e){msg('Error: '+(e.code||e.message));}};
  $('agForm').onsubmit=async e=>{e.preventDefault();const base={name:$('agName').value.trim().slice(0,40),look:{color:$('agColor').value,emoji:[...$('agEmoji').value.trim()].slice(0,2).join('')||'🤖'},personality:$('agPers').value.trim().slice(0,300),ownerName:(user.displayName||'').slice(0,80)};
    if(!base.name)return msg('Give your agent a name');
    try{let lat=agent?.lat,lon=agent?.lon;if(!agent){msg('Asking for your location (only you see the exact spot)…');const p=await getPos();lat=p.coords.latitude;lon=p.coords.longitude;}
      agent=await saveAgent(user.uid,{...base,lat,lon});delete $('agForm').dataset.edit;draw();render();flyTo(map,lon,lat,18);msg('✅ Saved. Only you can see its exact spot.');}
    catch(e){msg('Error: '+(e.code||e.message));}};
  onUser(async u=>{user=u;agent=null;delete $('agForm').dataset.edit;msg('');
    if(u){try{agent=await loadAgent(u.uid);if(agent)flyTo(map,agent.lon,agent.lat,18);}catch(e){msg('Could not load agent: '+(e.code||e.message));}}
    draw();render();});
  render();return {get agent(){return agent;}};}
