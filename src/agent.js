import {signIn,logOut,onUser,loadAgent,saveAgent,authMsg,redirectResult} from './firebase.js';
import {flyTo} from './map.js';
import {avatarLayer,toLook} from './avatar3d.js';
import {defaultLook,guessBase,sanitize,SKIN,HAIR_COLOURS,OUTFIT_COLOURS,HAIRSTYLES,OUTFITS,ACCESSORIES} from './character.js';
import {toast} from './ui.js';
const $=id=>document.getElementById(id);
export function setupAgent(map){let user=null,agent=null,loadSeq=0;const av=avatarLayer(map);const msg=t=>{$('agMsg').textContent=t;};
  const lk=lookEditor(l=>{if(agent&&$('agForm').dataset.edit)av.set({...agent,look:l});});
  const getPos=()=>new Promise((ok,no)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(ok,no,{enableHighAccuracy:true,timeout:20000}):no(new Error('Location not supported')));
  function render(){const signed=!!user;
    for(const id of ['signInBtn','agSignIn'])$(id).hidden=signed;$('userChip').hidden=!signed;$('agentBox').hidden=!signed;
    $('acctBtn').innerHTML='';if(signed&&user.photoURL){const i=new Image();i.src=user.photoURL;i.referrerPolicy='no-referrer';i.alt='';$('acctBtn').append(i);}else $('acctBtn').textContent='👤';
    if(signed){$('userName').textContent=user.displayName||user.email;$('userMail').textContent=user.email||'';}
    $('agForm').hidden=!signed||!!agent&&!$('agForm').dataset.edit;$('agView').hidden=!agent||!$('agForm').hidden;
    if(agent){$('agTitle').textContent=agent.name;$('agDesc').textContent=agent.personality||'';}
    $('agSave').textContent=agent?'💾 Save':'✨ Create my agent here';}
  const doSignIn=()=>signIn().catch(e=>{console.warn('signIn',e.code);toast('⚠️ '+authMsg(e),8000);});
  $('signInBtn').onclick=doSignIn;$('agSignIn').onclick=doSignIn;
  redirectResult.catch(e=>toast('⚠️ '+authMsg(e),8000));
  $('signOutBtn').onclick=()=>logOut().then(()=>toast('Signed out'));
  // Leaving the look editor without saving puts the saved look back on the map.
  document.addEventListener('vw-agent-sheet-leave',()=>{if(!$('agForm').dataset.edit)return;delete $('agForm').dataset.edit;if(agent)av.set(agent);render();});
  $('agEdit').onclick=()=>{$('agForm').dataset.edit=1;$('agName').value=agent.name;lk.load(agent.look,agent.ownerName||user.displayName||agent.name);$('agPers').value=agent.personality||'';render();};
  const go=()=>{if(agent)flyTo(map,agent.lon,agent.lat,19);};$('agGo').onclick=go;
  $('agMove').onclick=async()=>{msg('Getting your exact location…');try{const p=await getPos();agent=await saveAgent(user.uid,{...agent,ownerName:user.displayName||'',lat:p.coords.latitude,lon:p.coords.longitude});av.set(agent);go();msg(`Moved to where you are (±${Math.round(p.coords.accuracy)} m).`);}catch(e){msg('Error: '+(e.code||e.message));}};
  $('agForm').onsubmit=async e=>{e.preventDefault();const base={name:$('agName').value.trim().slice(0,40),look:lk.value(),personality:$('agPers').value.trim().slice(0,300),ownerName:(user.displayName||'').slice(0,80)};
    if(!base.name)return msg('Give your agent a name');
    try{let lat=agent?.lat,lon=agent?.lon;if(!agent){msg('Asking for your location (only you see the exact spot)…');const p=await getPos();lat=p.coords.latitude;lon=p.coords.longitude;}
      agent=await saveAgent(user.uid,{...base,lat,lon});delete $('agForm').dataset.edit;av.set(agent);render();go();msg('✅ Saved. Only you can see its exact spot.');}
    catch(e){msg('Error: '+(e.code||e.message));}};
  onUser(async u=>{const seq=++loadSeq;user=u;agent=null;delete $('agForm').dataset.edit;msg('');av.set(null);lk.load(null,u?.displayName||'');render();
    if(u){toast(`Signed in as ${u.displayName||u.email}`);
      for(let i=0;i<3&&seq===loadSeq;i++){try{const a=await loadAgent(u.uid);if(seq!==loadSeq)return;agent=a;break;}
        catch(e){if(i===2)toast('⚠️ Could not load your agent: '+(e.code||e.message),8000);else await new Promise(r=>setTimeout(r,1500*(i+1)));}}
      if(agent){av.set(agent);go();}}
    render();});
  render();lk.load(null,'');return {get agent(){return agent;},_preview(a){agent=a;av.set(a);render();}};}

// Character look editor in the agent sheet. Girl/Boy is only a starting guess from the first name; once the user taps the
// switch the name no longer overrides it (the guess runs only when the sheet loads), and each base keeps its own edits. Live-previews on the map character when editing.
const LABEL={none:'None',glasses:'👓 Glasses',headphones:'🎧 Headphones',cap:'🧢 Cap',bindi:'🔴 Bindi'};
function lookEditor(onChange){let per={},base='girl';
  const cur=()=>per[base]||(per[base]=defaultLook(base));
  const swatches=(id,list,key)=>{const el=$(id);el.innerHTML='';for(const c of list){const b=document.createElement('button');b.type='button';b.style.background=c;b.ariaLabel=c;b.dataset.c=c;
    b.onclick=()=>{cur()[key]=c;paint();};el.append(b);}};
  const opts=(id,list)=>{const el=$(id);el.innerHTML='';for(const v of list){const o=document.createElement('option');o.value=v;o.textContent=v[0].toUpperCase()+v.slice(1);el.append(o);}};
  function paint(){const l=cur();for(const b of $('lkBase').querySelectorAll('button'))b.classList.toggle('on',b.dataset.base===base);
    opts('lkHair',HAIRSTYLES[base]);opts('lkOutfit',OUTFITS[base]);$('lkHair').value=l.hair;$('lkOutfit').value=l.outfit;
    for(const [id,key] of [['lkSkin','skin'],['lkHairC','hairColour'],['lkOutfitC','outfitColour']])for(const b of $(id).children)b.classList.toggle('on',b.dataset.c===l[key]);
    const acc=$('lkAcc');acc.innerHTML='';for(const a of ACCESSORIES[base].filter(a=>a!=='none')){const lb=document.createElement('label'),i=document.createElement('input');i.type='checkbox';i.checked=l.acc.includes(a);
      i.onchange=()=>{l.acc=i.checked?[...new Set([...l.acc,a])]:l.acc.filter(x=>x!==a);onChange(value());};lb.append(i,' '+LABEL[a]);acc.append(lb);}
    onChange(value());}
  swatches('lkSkin',SKIN,'skin');swatches('lkHairC',HAIR_COLOURS,'hairColour');swatches('lkOutfitC',OUTFIT_COLOURS,'outfitColour');
  $('lkHair').onchange=()=>{cur().hair=$('lkHair').value;paint();};$('lkOutfit').onchange=()=>{cur().outfit=$('lkOutfit').value;paint();};
  for(const b of $('lkBase').querySelectorAll('button'))b.onclick=()=>{base=b.dataset.base;$('lkGuess').textContent='';paint();};
  function value(){return sanitize({...cur(),v:1,base});}
  return {value,load(look,name){per={};
    if(look){const l=toLook(look,name);base=l.base;per[base]=l;$('lkGuess').textContent='';}
    else{const g=guessBase(name);base=g.base;$('lkGuess').textContent=name&&g.confidence<.7?'(just a guess)':'';}
    paint();}};}
