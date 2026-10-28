// Redesign v4 (design/redesign-v4-spec.md): arrival, map HUD (status pill + Today card), World/Chats/Me tab pill,
// request sheet, connect moment and the Me sheet. Only real data is shown: no typing/Seen/counts are ever invented.
import {getChatSettings,setChatSettings,avatar,fillAvatars,lookOf,interestsOf} from './threads.js';
import {toast} from './ui.js';
import {BODY_SWATCHES,cleanColor,toLook} from './character-data.js';
import {lastVisit,markVisit} from './away.js';
import {renderApps,readReturn} from './connections.js';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const REDUCE=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
const buzz=p=>{try{navigator.vibrate?.(p);}catch{/* no haptics */}};
const atMs=v=>typeof v==='number'?v:typeof v?.toDate==='function'?v.toDate().getTime():typeof v?.seconds==='number'?v.seconds*1000:Date.parse(v)||0;
const day=()=>new Date().toDateString();
const ls={get:k=>{try{return localStorage.getItem(k);}catch{return null;}},set:(k,v)=>{try{localStorage.setItem(k,v);}catch{/* storage blocked */}}};
// Real-event line for the arrival: meets in the diary since the last visit. null when nothing happened.
export function arrivalLine(entries,since){const n=(entries||[]).filter(e=>e&&e.kind==='meet'&&atMs(e.at)>since).length;
  return n?`Your agent met ${n} ${n===1?'person':'people'} while you were away`:null;}
// Today card: only when something real happened in the last 24 h (a meet, or a pending request).
export function todayOf(f,now=Date.now()){if(!f)return null;const meets=(f.mine||[]).filter(e=>e&&e.kind==='meet'&&!e.town&&now-atMs(e.at)<86400000);
  const req=(f.incoming||[]).filter(r=>r&&(r.status||'pending')==='pending');const n=meets.length+req.length;if(!n)return null;
  const top=req[0]?{name:req[0].fromName,text:`${req[0].fromName||'Someone'} wants to say hi`}:{name:meets[0].withName,text:`${meets[0].withName||'Someone'}'s agent met yours`};
  return {...top,n};}
// "This week" on Me: real counts only; null when both are zero.
export function weekOf(f,threads,now=Date.now()){const W=7*86400000;const met=new Set((f?.mine||[]).filter(e=>e&&e.kind==='meet'&&now-atMs(e.at)<W).map(e=>e.withId||e.withName)).size;
  const fr=(threads||[]).filter(t=>now-atMs(t.createdAt)<W).length;if(!met&&!fr)return null;
  return [met?`Met ${met} agent${met>1?'s':''}`:'',fr?`${fr} became friend${fr>1?'s':''}`:''].filter(Boolean).join(' · ');}
const SPIN='<span class="spin" aria-hidden="true"></span>';
const ICON={pin:'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  chev:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  star:'<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/></svg>'};

export function setupV4({map,agents,town,threads,tabs,openSheet,closeSheet,getAgent,getUser,goChat=()=>{}}){
  document.body.classList.add('v4');
  // ---- tab pill: World · Chats · Me (the old Chat tab is reached from Me: "Talk to <name>")
  const nav=$('tabs');nav.innerHTML=`<button class="tab" role="tab" id="tabWorld" aria-selected="true">World</button><button class="tab" role="tab" id="tabChats" aria-selected="false">Chats<i class="udot" id="chatsDot" hidden></i></button><button class="tab" role="tab" id="tabMe" aria-selected="false">Me</button><button id="tabChat" hidden></button>`;
  const sel=t=>{for(const [id,k] of [['tabWorld','world'],['tabChats','chats'],['tabMe','me']])$(id).setAttribute('aria-selected',String(k===t));nav.dataset.on=t;};
  $('tabWorld').onclick=()=>{closeSheet();tabs.set('world');sel('world');};
  $('tabChats').onclick=()=>{tabs.set('world');openSheet('agentchats');town.loadActivity();sel('chats');$('chatsDot').hidden=true;};
  $('tabMe').onclick=()=>{tabs.set('world');openSheet('me');renderMe();sel('me');};
  document.addEventListener('vw-sheet-close',()=>sel('world'));
  const dot=$('agentDot');if(dot)new MutationObserver(()=>{$('chatsDot').hidden=dot.hidden;}).observe(dot,{attributes:true,attributeFilter:['hidden']});
  // ---- status pill (top) and Today card (bottom); offline -> grey "Offline · showing last seen"
  const hud=document.createElement('div');hud.id='v4Hud';hud.innerHTML=`<div id="v4Status" role="status"><i></i><span></span></div><button id="v4Today" type="button" hidden></button>`;document.body.appendChild(hud);
  function status(){const a=getAgent();const off=navigator.onLine===false;const s=$('v4Status');s.classList.toggle('off',off);s.hidden=!a&&!off;
    s.querySelector('span').textContent=off?'Offline · showing last seen':`Agent ${a?.status?.kind==='meeting'?'meeting someone':a?.status?.kind==='resting'?'resting':'exploring'}${a?.area?' · '+a.area:''}`;document.body.classList.toggle('offline',off);}
  addEventListener('online',status);addEventListener('offline',status);setInterval(status,15000);
  function today(f){const t=todayOf(f),b=$('v4Today');b.hidden=!t||!getAgent();document.body.classList.toggle('v4TodayOn',!b.hidden);if(!t)return;
    const lk=f.incoming?.find(r=>r.fromName===t.name)?lookOf(agents.get(f.incoming.find(r=>r.fromName===t.name).fromAgentId)?.look,t.name):lookOf(agents.get((f.mine||[]).find(e=>e.withName===t.name)?.withId)?.look,t.name);
    b.innerHTML=`${avatar(lk,'cav face')}<span class="tMain"><b>${esc(t.text)}</b><small>Today in your world · ${t.n} new</small></span>${ICON.chev}`;fillAvatars(b);}
  $('v4Today').onclick=()=>$('tabChats').click();
  async function refreshHud(u=getUser()){if(u)hudU=u;status();if(!u||u.isAnonymous)return;try{await town.checkUnread(u);today(await town.peek(u));}catch{/* feed down: hide */}}
  // ---- arrival: full version once a day, short glide otherwise; a tap skips; reduced motion = fade only
  let arrived=false;
  function arrive({entries}={}){if(arrived)return;arrived=true;const me=agents.get('me');if(!me)return;const ll=[me.lon,me.lat];const q=new URLSearchParams(location.search);const full=ls.get('vw-arrive')!==day()&&(q.get('onb')!=='0'||q.get('arrive')==='1');/* ?onb=0 skips intros (tests) */const line=arrivalLine(entries,lastVisit());markVisit();
    if(REDUCE()){map.jumpTo({center:ll,zoom:18});if(!full)return;}
    else if(!full){map.easeTo({center:ll,zoom:18,duration:1100,easing:t=>1-Math.pow(1-t,3)});return;}
    ls.set('vw-arrive',day());const o=document.createElement('div');o.id='v4Arrive';o.setAttribute('role','dialog');o.setAttribute('aria-label','Welcome back');
    o.innerHTML=`<i class="prog"></i><div class="vig"></div><div class="txt"><h2>Welcome back</h2>${line?`<p>${esc(line)}</p>`:''}</div><small>Tap anywhere to skip</small>`;document.body.appendChild(o);
    if(!REDUCE()){map.jumpTo({center:ll,zoom:15});map.easeTo({center:ll,zoom:18,duration:900,easing:t=>1-Math.pow(1-t,3)});setTimeout(()=>agents.play?.('wave'),900);}
    let done=false;const end=()=>{if(done)return;done=true;map.stop?.();map.jumpTo({center:ll,zoom:18});o.classList.add('out');setTimeout(()=>o.remove(),REDUCE()?150:240);};
    o.addEventListener('pointerdown',end);setTimeout(end,line?2600:1800);requestAnimationFrame(()=>o.classList.add('on'));}
  // ---- request sheet (bottom): creature, agent's note, chips (shared first ★), Accept (white) / Not now (ghost = silent decline)
  const rq=document.createElement('div');rq.id='v4Req';rq.hidden=true;rq.innerHTML=`<div class="scrimV4"></div><section class="v4Sheet" role="dialog" aria-label="Request"><div class="grab"></div><div class="body"></div></section>`;document.body.appendChild(rq);
  function closeReq(){rq.classList.remove('on');setTimeout(()=>{rq.hidden=true;},REDUCE()?150:240);}
  rq.querySelector('.scrimV4').onclick=closeReq;
  document.addEventListener('vw-request',e=>{const {r,look,mine}=e.detail;const meet=(mine||[]).find(m=>m.id===r.meetId||m.withId===r.fromAgentId);const shared=(meet?.shared||[]).slice(0,3);
    const chips=[...shared.slice(0,1).map(x=>`<span class="chip hl">${ICON.star}Both like ${esc(x)}</span>`),...shared.slice(1).map(x=>`<span class="chip">${esc(x)}</span>`)].join('');
    const b=rq.querySelector('.body');b.innerHTML=`${avatar(look,'cav xl bob',0)}<h2>${esc(r.fromName||'Someone')}</h2>${String(r.text||'').trim()?`<p class="note">Agent's note: “${esc(String(r.text).slice(0,200))}”</p>`:''}<div class="chips">${chips}</div><p class="err" role="alert"></p><button type="button" class="primary v4Accept">Accept</button><button type="button" class="ghost v4Later">Not now</button>`;
    fillAvatars(b);rq.hidden=false;requestAnimationFrame(()=>rq.classList.add('on'));
    const acc=b.querySelector('.v4Accept'),err=b.querySelector('.err');
    b.querySelector('.v4Later').onclick=async()=>{closeReq();try{await town.respondById(r.id,'decline');}catch{/* silent */}};
    acc.onclick=async()=>{buzz(10);acc.style.width=acc.offsetWidth+'px';acc.innerHTML=SPIN;acc.disabled=true;err.textContent='';
      try{const res=await town.respondById(r.id,'accept');closeReq();if(res.threadId)connected({name:r.fromName,look,shared,threadId:res.threadId});}
      catch(x){acc.disabled=false;acc.textContent='Accept';err.textContent=x?.status===404||x?.status===409?'This request is no longer available.':'Something went wrong. Try again.';}};});
  // ---- connect moment (<1.5 s, once per connection): creatures slide in from the edges, turn and wave; "Say hi" opens the chat
  function connected({name,look,shared=[],threadId}){const k='vw-conn-'+threadId;if(ls.get(k)){threads.openThread(threadId);return;}ls.set(k,'1');buzz([15,40,15]);
    const me=getAgent();const o=document.createElement('div');o.id='v4Conn';o.setAttribute('role','dialog');o.setAttribute('aria-label','Connected');
    o.innerHTML=`<div class="glow"></div><div class="pair">${avatar(lookOf(me?.look,me?.name),'cav xl l',1)}${avatar(look,'cav xl r',-1)}</div><h2>You and ${esc(name||'your new friend')} are connected</h2>${shared[0]?`<p>You both like ${esc(shared[0])}. Say hi and ask about it.</p>`:''}<div class="acts"><button type="button" class="primary">Say hi</button><button type="button" class="ghost">Later</button></div>`;
    document.body.appendChild(o);fillAvatars(o);requestAnimationFrame(()=>o.classList.add('on'));
    const close=()=>{o.classList.add('out');setTimeout(()=>o.remove(),REDUCE()?150:240);};
    o.querySelector('.primary').onclick=()=>{buzz(10);close();closeSheet();threads.openThread(threadId);};o.querySelector('.ghost').onclick=()=>{close();town.loadActivity();};}
  // ---- Me sheet: hero creature + name, interests, colour row, This week (real), one primary
  let hudU=null;
  function renderMe(){const a=getAgent(),box=$('v4Me');if(!box)return;if(!a){box.innerHTML=`<button type="button" class="primary" id="meSignIn">Create your agent</button>`;$('meSignIn').onclick=()=>{openSheet('agent');};return;}
    const l=toLook(a.look,a.name),since=atMs(a.createdAt),ints=interestsOf({interests:a.interests}).concat((a.interests||[]).slice(3)).slice(0,6),wk=weekOf(town.feed,threads.threads);
    box.innerHTML=`<div class="meHero">${avatar(l,'cav lg',0)}<div><h2>${esc(a.name||'My agent')}</h2><small>Your agent${since?` · exploring since ${new Date(since).toLocaleDateString(undefined,{day:'numeric',month:'short'})}`:''}</small></div></div>`
      +`<div class="capLbl">Interests</div><div class="chips">${ints.map(x=>`<span class="chip">${esc(x)}</span>`).join('')}<button type="button" class="chip add" id="meAdd">+ Add</button></div>`
      +`<div class="capLbl">Colour</div><div class="colRow" id="meCol" role="radiogroup" aria-label="Body colour"><button type="button" role="radio" class="swc def" data-col="" aria-label="Default colour"></button>${BODY_SWATCHES.map((c,i)=>`<button type="button" role="radio" class="swc" data-col="${c}" style="--c:${c}" aria-label="Colour ${i+1}"></button>`).join('')}<label class="swc cust" aria-label="More colours"><input type="color" value="${l.color||'#a99bff'}" aria-label="More colours"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></svg></label></div>`
      +(wk?`<div class="week"><b>This week</b><small>${esc(wk)}</small></div>`:'')
      +`<button type="button" class="primary" id="meEdit">Edit my agent</button><button type="button" class="ghost" id="meTalk">Talk to ${esc(a.name||'my agent')}</button>`
      +`<div id="meApps" hidden></div>`
      +`<div class="capLbl">Privacy</div><div class="privRow" id="mePriv" hidden><div><b>Read receipts</b><small>When off, neither of you sees Seen.</small></div><button type="button" role="switch" class="sw" id="meRR" aria-checked="true" aria-label="Read receipts"><i></i></button></div>`
      +`<div class="meTools"><button type="button" data-go="family">Family</button><button type="button" data-go="layers">Layers</button><button type="button" data-go="search">Search</button><button type="button" data-go="account">Account</button></div>`;
    fillAvatars(box);const row=$('meCol');const paint=()=>{const c=toLook(getAgent()?.look).color||null;for(const b of row.querySelectorAll('.swc[data-col]'))b.classList.toggle('on',(b.dataset.col||null)===c),b.setAttribute('aria-checked',String((b.dataset.col||null)===c));const cu=row.querySelector('.cust');const custom=!!c&&!BODY_SWATCHES.includes(c);cu.classList.toggle('on',custom);if(custom)cu.style.setProperty('--c',c);};paint();
    const setC=async c=>{await window.__vw.agent.setColor(cleanColor(c));paint();const img=box.querySelector('.meHero img');img.removeAttribute('src');img.parentElement.dataset.look=JSON.stringify(toLook(getAgent().look));fillAvatars(box);};
    for(const b of row.querySelectorAll('button.swc'))b.onclick=()=>setC(b.dataset.col);let tt=0;row.querySelector('input').oninput=e=>{clearTimeout(tt);const v=e.target.value;tt=setTimeout(()=>setC(v),160);};
    $('meEdit').onclick=()=>{openSheet('agent');$('agEdit')?.click();};$('meTalk').onclick=()=>{closeSheet();goChat();};
    $('meAdd').onclick=()=>{closeSheet();$('chatInterests')?.click();};
    for(const b of box.querySelectorAll('.meTools button'))b.onclick=()=>openSheet(b.dataset.go);
    // Privacy & read receipts (GET/POST /me/chat-settings). Hidden when signed out or the endpoint is missing.
    const u=getUser()||hudU,pr=$('mePriv'),rr=$('meRR');if(u&&!u.isAnonymous)getChatSettings(u).then(j=>{if(typeof j?.readReceipts!=='boolean')return;rr.setAttribute('aria-checked',String(j.readReceipts));pr.hidden=false;pr.previousElementSibling.hidden=false;}).catch(()=>{});
    pr.previousElementSibling.hidden=true;
    // Apps (Connect v1): hidden until GET /apps answers; Notion/Spotify show Coming soon.
    if(u&&!u.isAnonymous)renderApps($('meApps'),u);
    rr.onclick=async()=>{const on=rr.getAttribute('aria-checked')!=='true';rr.setAttribute('aria-checked',String(on));rr.disabled=true;
      try{const j=await setChatSettings(getUser()||hudU,on);rr.setAttribute('aria-checked',String(j?.readReceipts??on));}catch{rr.setAttribute('aria-checked',String(!on));toast("Couldn't save. Try again.");}rr.disabled=false;};}
  // Back from Google consent (#/me?app=&result=): open Me so the tile shows the new state.
  if(readReturn())setTimeout(()=>{tabs.set('world');openSheet('me');renderMe();sel('me');},600);
  status();setTimeout(refreshHud,1500);setInterval(()=>{if(!document.hidden)refreshHud();},60000);
  return {arrive,connected,renderMe,refreshHud,today,status,sel,forget:()=>{hudU=null;}};}
