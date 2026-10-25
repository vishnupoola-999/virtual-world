// First-60-seconds onboarding (Diggy's spec: /workspace/design/onboarding-spec.md, docs/DESIGN.md).
// 6 steps over the real map: night globe → Google sign-in + system location prompt → dive and landing →
// pick (two unlabelled cards, nothing preselected, no name guess) and name → interests (3-5, design/living-spec.md §1) → the agent greets first.
// Returning users (signed in with an agent) never see it. Never blocks on location: city fallback, then Warangal centre.
import {signIn,saveAgent,saveInterests,currentUser} from './firebase.js';
import {ICONS,LABEL,icon} from './interests.js';
import {defaultLook,sanitize} from './character-data.js';
import {toast} from './ui.js';
const $=id=>document.getElementById(id);
const DEFAULT_SPOT={lat:17.9689,lon:79.5941,name:'Warangal'};
const RM=()=>matchMedia('(prefers-reduced-motion: reduce)').matches||new URLSearchParams(location.search).get('rm')==='1';
const T0=performance.now();
// Analytics: no coordinates and no names in properties. Kept on window.__vwEvents until Firebase Analytics is wired.
export function track(ev,props={}){(window.__vwEvents||=[]).push({ev,...props,t:Math.round(performance.now()-T0)});}
const bucket=m=>m<=20?'<=20':m<=100?'<=100':m<=1000?'<=1000':'>1000';
const CANCEL=new Set(['auth/popup-closed-by-user','auth/cancelled-popup-request','auth/user-cancelled','SIGN_IN_CANCELED','12501']);
const el=(tag,cls,html)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e;};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

export function setupOnboarding(map,{onDone=()=>{},onCreated=()=>{},onFindFriends=()=>{}}={}){
  const root=$('onb');let step=0,stepT=0,spot=null,locP=null,base=null,cards=null,globeRaf=0,active=false,timers=[];
  const later=(fn,ms)=>{const t=setTimeout(fn,ms);timers.push(t);return t;};
  const clearTimers=()=>{for(const t of timers)clearTimeout(t);timers=[];};
  const body=$('onbBody');
  // ---- chrome
  function chrome(n,{back=false,skip=''}={}){$('onbBack').hidden=!back;$('onbSkip').hidden=!skip;$('onbSkip').textContent=skip;
    const p=$('onbPills');p.innerHTML='';p.setAttribute('aria-valuenow',n);for(let i=1;i<=6;i++)p.append(el('i',i===n?'on':i<n?'done':''));}
  function show(n,how='next'){if(step)track('onboarding_step_complete',{step,ms:Math.round(performance.now()-stepT),how});
    clearTimers();stopGlobe();if(step===4&&n!==4)disposeCards();step=n;stepT=performance.now();track('onboarding_step_view',{step:n});
    root.dataset.step=n;body.innerHTML='';[null,s1,s2,s3,s4,s5,s6][n]();}
  function open(n=1){if(active)return;active=true;root.hidden=false;document.body.classList.add('onb');show(n);}
  function close(){active=false;clearTimers();stopGlobe();disposeCards();root.hidden=true;document.body.classList.remove('onb');}
  $('onbBack').onclick=()=>{if(step===2)show(1,'back');else if(step===4)show(2,'back');};
  $('onbSkip').onclick=()=>{if(step===1)show(2,'skip');else if(step===3)landNow();};
  // ---- offline pill
  const offline=()=>{const off=!navigator.onLine;$('onbOffline').hidden=!off;if(off&&active)track('offline_shown');};
  addEventListener('online',offline);addEventListener('offline',offline);offline();

  // ---- 1. night globe
  function startGlobe(){map.jumpTo({zoom:1.6,pitch:0,bearing:0});if(RM())return;let last=0;
    const f=t=>{globeRaf=requestAnimationFrame(f);if(document.hidden||t-last<33)return;const dt=last?(t-last)/1000:0;last=t;
      const c=map.getCenter();map.jumpTo({center:[c.lng+6*dt,c.lat]});};globeRaf=requestAnimationFrame(f);}
  function stopGlobe(){cancelAnimationFrame(globeRaf);globeRaf=0;}
  function s1(){chrome(1,{skip:'Skip intro'});startGlobe();
    body.append(el('div','onbBottom',`<span class="cap">Virtual World</span><h1>Your agent is waiting to be <em>born.</em></h1><p>It lives where you live, makes friends, and gets things done for you.</p><button class="primary big" id="onbGo">Get started</button><button class="ghost" id="onbHave" type="button">I already have an agent</button>`));
    $('onbGo').onclick=()=>show(2);$('onbHave').onclick=()=>show(2);}

  // ---- 2. sign in (then the system location prompt, no explainer)
  function s2(){chrome(2,{back:true});startGlobe();
    body.append(el('div','onbBottom',`<h2>Virtual World</h2><p>One tap and we'll get your agent ready.</p><button class="primary big g" id="onbSign"><span class="gl">G</span> Continue with Google</button><small class="fine">We only use your name and photo. <a href="#" tabindex="-1">Terms</a> · <a href="#" tabindex="-1">Privacy</a></small>`));
    const b=$('onbSign');b.onclick=async()=>{track('signin_tap');b.disabled=true;b.lastChild.textContent=' Signing in…';
      try{if(!navigator.onLine)throw Object.assign(new Error('offline'),{code:'auth/network-request-failed'});
        await signIn();if(!currentUser())throw Object.assign(new Error('no user'),{code:'auth/popup-closed-by-user'});
        track('signin_success',{provider:'google'});/* onUser → agent load → afterSignIn() decides */}
      catch(e){const code=String(e?.code||e?.message||'unknown');
        if(CANCEL.has(code)||/cancel/i.test(code))track('signin_cancel');
        else{track('signin_error',{code});toast("Couldn't sign in. Check your connection and try again.",6000);}
        if(step===2){b.disabled=false;b.lastChild.textContent=' Continue with Google';}}};}
  // Called once the signed-in user's agent load finished and there is no agent yet.
  function afterSignIn(){if(!active)open(3);locP||=locate();show(3);}

  // ---- location: fast fix (no high accuracy), 8 s timeout, never re-prompt this session
  function locate(){return new Promise(ok=>{let done=false;const fin=v=>{if(!done){done=true;ok(v);}};
    const fallback=async()=>{track('location_denied');try{const r=await fetch('https://get.geojs.io/v1/ip/geo.json',{signal:AbortSignal.timeout(4000)});const j=await r.json();
        if(isFinite(+j.latitude)&&isFinite(+j.longitude)){track('location_fallback',{level:'city'});return fin({lat:+j.latitude,lon:+j.longitude,approx:true,source:'ip',name:j.city||'your city',city:j.city||'your city'});}}catch{/* fall through */}
      track('location_fallback',{level:'default'});fin({...DEFAULT_SPOT,approx:true});};
    if(sessionStorage.getItem('vw-loc-asked')==='denied'||!navigator.geolocation||new URLSearchParams(location.search).get('state')==='loc-denied'){fallback();return;}
    track('location_prompt');sessionStorage.setItem('vw-loc-asked','1');const to=setTimeout(fallback,8000);
    // Coarse first fix (>200 m): retry once with high accuracy; still >200 m → keep the better fix but mark it approximate.
    const got=(p,retried)=>{track('location_granted',{accuracy_m:bucket(p.coords.accuracy)});
      if(p.coords.accuracy>200&&!retried){navigator.geolocation.getCurrentPosition(q=>{clearTimeout(to);if(!done)got(q.coords.accuracy<p.coords.accuracy?q:p,true);},
        ()=>{clearTimeout(to);if(!done)got(p,true);},{enableHighAccuracy:true,timeout:6000,maximumAge:0});return;}
      clearTimeout(to);fin({lat:p.coords.latitude,lon:p.coords.longitude,approx:p.coords.accuracy>200,source:'gps'});};
    navigator.geolocation.getCurrentPosition(p=>{if(done)return;got(p,false);},
      ()=>{clearTimeout(to);sessionStorage.setItem('vw-loc-asked','denied');fallback();},{enableHighAccuracy:false,timeout:8000,maximumAge:600000});});}
  async function placeName(s){if(s.name)return s.name;try{const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=${s.lat}&lon=${s.lon}`,{headers:{'Accept-Language':'en'},signal:AbortSignal.timeout(4000)});
    const a=(await r.json()).address||{};const city=a.city||a.town||a.village||a.county||'';const road=a.road||a.neighbourhood||a.suburb||'';
    s.city=city;return s.name=[road,city].filter(Boolean).join(', ')||city||'your spot';}catch{return s.name='your spot';}}

  // ---- 3. dive + landing
  let landed=false;
  async function s3(){chrome(3,{skip:'Skip'});import('./cards3d.js').catch(()=>{});// warm three.js during the dive, so step 4's cards are ready
    landed=false;
    body.append(el('div','onbCap','Friends only see the approximate area'),el('div','orb',''),el('div','onbBottom fade','<span class="onbChip" id="onbChip">Finding your spot…</span><h2>Your agent has landed</h2><p id="onbNote">Let\'s give it a name and a look.</p><button class="primary big" id="onbNext3">Continue</button>'));
    $('onbNext3').onclick=()=>show(4);
    spot=await (locP||=locate());if(step!==3)return;
    const nameP=placeName(spot);
    if(RM()){map.jumpTo({center:[spot.lon,spot.lat],zoom:17,pitch:60,bearing:-20});root.classList.add('xfade');later(()=>root.classList.remove('xfade'),200);later(landNow,200);}
    else{map.flyTo({center:[spot.lon,spot.lat],zoom:17,pitch:60,bearing:-20,duration:2600,curve:1.6,essential:true});later(()=>{body.querySelector('.orb').classList.add('drop');later(landNow,1600);},2600);}
    nameP.then(n=>{if(step!==3)return;const city=spot.city||n;$('onbChip').textContent=spot.approx?`${city} (approximate)`:n;
      if(spot.approx)$('onbNote').innerHTML=`Couldn't get your exact spot, so your agent is in <b>${esc(city)}</b> for now. You can move it later.`+(spot.source==='ip'?'<small class="ipNote">The city is a rough guess from your internet address (via get.geojs.io). Only the city is used.</small>':'');});}
  function landNow(){if(step!==3||landed)return;landed=true;if(spot)map.jumpTo({center:[spot.lon,spot.lat],zoom:17,pitch:60,bearing:-20});
    const o=body.querySelector('.orb');o.classList.add('landed');track('agent_landed');later(()=>body.querySelector('.onbBottom').classList.add('in'),RM()?0:1700);$('onbSkip').hidden=true;}

  // ---- 4. pick + name: ONE renderer draws both cards via scissor/viewport, ~30 fps, paused when hidden
  function s4(){chrome(4,{back:true});base=null;
    body.append(el('div','onbPanel',`<h2>Pick your agent</h2><p>Tap one. You can change everything later.</p>
      <div class="cards" id="onbCards" role="radiogroup" aria-label="Choose a character"><canvas id="onbCv" aria-hidden="true"></canvas>
      <button type="button" role="radio" aria-checked="false" aria-label="Character 1" data-base="girl"></button><button type="button" role="radio" aria-checked="false" aria-label="Character 2" data-base="boy"></button></div>
      <label class="nm">Name your agent<input id="onbName" maxlength="16" autocomplete="off" enterkeyhint="done" placeholder="e.g. Chinni"></label>
      <button class="primary big" id="onbCreate" disabled>Continue</button><button class="link" id="onbLater" type="button">Customise look later</button>`));
    const btns=[...body.querySelectorAll('#onbCards button')],name=$('onbName'),go=$('onbCreate');
    const upd=()=>{go.disabled=!(base&&name.value.trim());};name.oninput=upd;
    for(const b of btns)b.onclick=()=>{base=b.dataset.base;$('onbCards').classList.add('chosen');for(const x of btns){x.classList.toggle('on',x===b);x.setAttribute('aria-checked',String(x===b));}
      cards?.wave(base);track('look_base_selected',{base});upd();};
    $('onbLater').onclick=()=>{track('customise_later_tap');if(!go.disabled)go.click();else toast(base?'Give your agent a name first':'Tap a character first');};
    go.onclick=()=>{const n=name.value.trim().slice(0,16);if(!base||!n)return;track('agent_named',{len:n.length});create(n);};
    const want=step;import('./cards3d.js').then(m=>{if(step!==want||!btns[0].isConnected)return;cards=m.cardRenderer($('onbCv'),btns);if(base)cards?.wave(base);}).catch(e=>console.warn('cards',e?.message));}
  function disposeCards(){cards?.dispose();cards=null;}
  function create(n){const u=currentUser();if(!u||!spot)return;const look=sanitize({...defaultLook(base),v:1,base});
    const a={name:n,look,personality:'',ownerName:(u.displayName||'').slice(0,80),lat:spot.lat,lon:spot.lon,spotApprox:!!spot.approx};
    track('agent_created',{base,customised:false});
    // Firestore queues the write while offline; don't block the greeting on the server ack.
    const local={...a,approx:{lat:Math.round(a.lat*100)/100,lon:Math.round(a.lon*100)/100},preciseVisibility:'private'};
    saveAgent(u.uid,a).then(d=>onCreated(d,true)).catch(e=>toast('Could not save your agent: '+(e.code||e.message),8000));
    onCreated(local,false);agentName=n;show(5);}

  // ---- 5. interests: pick 3-5 of 16 chips, optional one-line bio (saved via saveInterests; never blocks the greeting)
  let agentName='';
  function s5(){chrome(5);track('interests_view');const sel=new Set();const who=esc(agentName||'Your agent');
    const ck='<span class="ck"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c9c1ff" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg></span>';
    body.append(el('div','onbInt',`<div class="hd"><h2>What are you into?</h2><p>Pick 3 to 5. ${who} uses these to find people and agents you'll click with.</p></div>
      <div class="count"><b id="intCnt" aria-live="polite">0 of 5</b><span class="meter" id="intMeter" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span></div>
      <div class="grid" id="intGrid" role="group" aria-label="Interests">${Object.keys(ICONS).map(k=>`<button type="button" class="chip" aria-pressed="false" data-k="${k}">${icon(k)}${LABEL[k]}${ck}</button>`).join('')}</div>
      <div class="about"><label for="intBio"><span>About you <span class="opt">· optional</span></span><span id="intBc">0/80</span></label>
        <textarea id="intBio" rows="2" maxlength="80" placeholder="e.g. CSE 2nd year at NIT Warangal, into robotics" autocomplete="off" enterkeyhint="done"></textarea><small>Friends' agents see this line next to your agent.</small></div>
      <div class="bottom"><div class="hint" id="intHint">Pick 3 more</div><button class="primary big" id="intNext" disabled>Continue</button></div>`));
    const ui=()=>{const n=sel.size;for(const c of body.querySelectorAll('.chip')){c.setAttribute('aria-pressed',String(sel.has(c.dataset.k)));c.classList.toggle('full',n>=5);}
      $('intCnt').textContent=`${n} of 5`;[...$('intMeter').children].forEach((m,i)=>m.classList.toggle('on',i<n));$('intNext').disabled=n<3;
      $('intHint').textContent=n<3?`Pick ${3-n} more`:n<5?`Nice. You can add up to ${5-n} more.`:"That's 5, the max";};
    $('intGrid').onclick=e=>{const c=e.target.closest('.chip');if(!c)return;const k=c.dataset.k;if(sel.has(k))sel.delete(k);else if(sel.size<5)sel.add(k);else return;track('interest_toggle',{key:k,on:sel.has(k)});ui();};
    const bio=$('intBio');bio.oninput=()=>{if(/\n/.test(bio.value))bio.value=bio.value.replace(/\n+/g,' ').slice(0,80);$('intBc').textContent=bio.value.length+'/80';};
    bio.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();bio.blur();}};
    $('intNext').onclick=()=>{if(sel.size<3)return;const list=[...sel],b=bio.value.replace(/\s+/g,' ').trim().slice(0,80);track('interests_saved',{count:list.length,has_bio:!!b});
      const u=currentUser();if(u)saveInterests(u.uid,list,b).catch(e=>toast("Couldn't save your interests: "+(e.code||e.message),6000));show(6);};
    ui();}

  // ---- 6. first chat: local template greeting, never needs the network
  function s6(){chrome(6);const first=(currentUser()?.displayName||'').split(/\s+/)[0];const hi=first?`Hi ${esc(first)}.`:'Hi.';
    const msg=spot.approx?`${hi} I'm in ${esc(spot.city||spot.name||'your city')} for now. You can move me to your exact spot anytime. Want me to find your friends?`
      :`${hi} I'm here on ${esc((spot.name||'your street').split(',')[0])}. Want me to find your friends?`;
    body.append(el('div','onbChat',`<div class="onbHead"><b>${esc(document.querySelector('.agLabel')?.textContent||'Your agent')}</b><button id="onbMove" type="button">Move my agent</button></div>
      <div class="log"><div class="bub typing" id="onbBub"><i></i><i></i><i></i></div></div><div class="onbChips fade" id="onbChips"><button class="brand" id="onbFind">Find friends</button><button id="onbNot">Not now</button></div>`));
    later(()=>{const b=$('onbBub');b.classList.remove('typing');b.innerHTML=msg;track('first_message_shown',{ms_since_open:Math.round(performance.now()-T0)});},1200);
    later(()=>$('onbChips').classList.add('in'),RM()?1200:2200);
    $('onbFind').onclick=()=>{track('find_friends_tap');close();onFindFriends();};
    $('onbNot').onclick=()=>{track('find_friends_dismiss');close();onDone('chat');};
    $('onbMove').onclick=()=>{track('move_agent_tap',{from:'onboarding'});close();onDone('move');};}

  return {open,close,afterSignIn,_show:show,get active(){return active;},get step(){return step;}};}

