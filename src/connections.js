// TEMPORARY minimal UI, self-contained so it can be deleted when Buildy Design's full Apps UI (#64) lands:
// remove this file, connections.css, their two tags in index.html, the sw.js entries and the hook in chat.js.
// Connect v1 (design/connect-v1-spec.md, docs/DESIGN.md "Connect apps API"): Apps section in Me + in-chat confirm card.
// Tokens never touch the browser. The proxy keeps them; this file only shows state and sends taps.
import {API} from './threads.js';
import {toast} from './ui.js';
import {currentUser} from './firebase.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const buzz=p=>{try{navigator.vibrate?.(p);}catch{/* no haptics */}};
const MARK={gdrive:'D',gcal:'C',gmail:'M',notion:'N',spotify:'S'};
async function call(user,path,init={}){const t=await user.getIdToken();const r=await fetch(API+path,{...init,headers:{...(init.headers||{}),Authorization:'Bearer '+t,...(init.body?{'Content-Type':'application/json'}:{})}});
  let j=null;try{j=await r.json();}catch{/* empty */}if(!r.ok){const e=new Error(j?.error||'failed');e.status=r.status;throw e;}return j;}
export const listApps=u=>call(u,'/apps');
export const decideAction=(u,id,decision)=>call(u,'/actions/'+encodeURIComponent(id),{method:'POST',body:JSON.stringify({decision})});
const CK='vw-conn-confirm';
const STATE={connect:['Connect','c'],connected:['Connected','ok'],reauth:['Sign in again','e'],soon:['Coming soon','w'],connecting:['Connecting…','w'],error:['Try again','e']};
export function tileHtml(a){const [label,cls]=STATE[a.state]||STATE.soon;return `<button type="button" class="tile" data-app="${esc(a.id)}" data-state="${esc(a.state)}"${a.state==='soon'?' aria-disabled="true"':''}><span class="mk">${MARK[a.id]||esc(a.name[0])}</span><span class="tn">${esc(a.name)}${a.email&&a.state!=='soon'?`<small>${esc(a.email)}</small>`:''}</span><span class="st ${cls}">${label}</span></button>`;}

// Renders into box (a div in the Me sheet). Hidden when signed out/anonymous or the proxy has no /apps yet.
export async function renderApps(box,user){if(!box)return;box.hidden=true;if(!user||user.isAnonymous)return;
  // Finish an OAuth round trip: the proxy only saves the grant once this signed-in user confirms it.
  let back=null;try{back=JSON.parse(sessionStorage.getItem(CK)||'null');sessionStorage.removeItem(CK);}catch{/* storage blocked */}
  if(back?.nonce&&back.app){try{await call(user,'/apps/'+encodeURIComponent(back.app)+'/confirm',{method:'POST',body:JSON.stringify({nonce:back.nonce})});buzz([15,40,15]);toast('Connected');}catch{toast("Couldn't connect. Try again.");}}
  let data;try{data=await listApps(user);}catch{return;}
  const apps=Array.isArray(data?.apps)?data.apps:[];if(!apps.length)return;
  const n=apps.filter(a=>a.state==='connected').length;
  box.innerHTML=`<div class="appsHd"><span class="cap">Apps</span><span class="meta">${n} of ${apps.length} connected</span></div><div class="appsList">${apps.map(tileHtml).join('')}</div><div class="appsAsk" hidden></div><p class="meta appsNote">Your agent always asks before it sends, pays or submits.</p>`;
  box.hidden=false;const ask=box.querySelector('.appsAsk');
  for(const b of box.querySelectorAll('.tile'))b.onclick=async()=>{const a=apps.find(x=>x.id===b.dataset.app);if(!a||a.state==='soon'){toast('Coming soon');return;}
    if(a.state==='connected'){ask.hidden=false;const g=apps.filter(x=>x.id!==a.id&&/^g(drive|cal)$/.test(x.id)&&x.state==='connected').map(x=>x.name);
      ask.innerHTML=`<p>Disconnect ${esc(a.name)}? Your agent loses access straight away.${/^g(drive|cal)$/.test(a.id)&&g.length?` Google removes access for the whole account, so ${esc(g.join(' and '))} will need you to sign in again.`:''}</p><div class="acts"><button type="button" class="ghost">Cancel</button><button type="button" class="primary">Disconnect</button></div>`;
      ask.querySelector('.ghost').onclick=()=>{ask.hidden=true;};
      ask.querySelector('.primary').onclick=async()=>{try{await call(user,'/apps/'+a.id,{method:'DELETE'});toast(`${a.name} disconnected`);}catch{toast("Couldn't disconnect. Try again.");}renderApps(box,user);};return;}
    const st=b.querySelector('.st');st.className='st w';st.textContent='Connecting…';
    try{const j=await call(user,'/apps/'+a.id+'/connect',{method:'POST'});if(j?.authUrl&&/^https:\/\/accounts\.google\.com\//.test(j.authUrl))location.href=j.authUrl;else throw new Error('no url');}
    catch(e){st.className='st e';st.textContent=e.status===503?'Coming soon':'Try again';}};}

// After the OAuth round trip the proxy sends us to ?connect=<app>&nonce=<n>#/me (or ?connect=<app>&result=error#/me).
// The nonce is kept for POST /apps/:id/confirm, which renderApps sends once the signed-in user is known.
export function readReturn(loc=location){const q=new URLSearchParams(loc.search||'');const app=q.get('connect');if(!app)return null;
  try{history.replaceState(null,'',loc.pathname+(loc.hash||''));}catch{/* ignore */}
  const nonce=q.get('nonce')||'';const ok=/^[A-Za-z0-9_-]{16,40}$/.test(nonce)&&q.get('result')!=='error';
  if(ok){try{sessionStorage.setItem(CK,JSON.stringify({app,nonce}));}catch{/* storage blocked */}toast('Finishing…');}else toast("Couldn't connect. Try again.");return {app,result:ok?'ok':'error'};}

// In-chat confirm card for one pending action {id, app, kind, title, summary, expiresAt}. Approve runs it once.
const APP_NAME={gdrive:'Google Drive',gcal:'Google Calendar',gmail:'Gmail'};
const safeLink=(u,re)=>typeof u==='string'&&re.test(u)?u:'';
export function actionCard(action,getUser,now=()=>Date.now()){const d=document.createElement('div');d.className='msg bot actCard';
  const name=APP_NAME[action.app]||'App';
  d.innerHTML=`<div class="card"><div class="row"><span class="mk sm">${MARK[action.app]||'A'}</span><span class="cap">${esc(name)}</span></div><b class="ttl"></b><p class="sum meta"></p><div class="acts"><button type="button" class="ghost">Cancel</button><button type="button" class="primary">Approve</button></div><p class="res" hidden></p></div>`;
  d.querySelector('.ttl').textContent=action.title||'';d.querySelector('.sum').textContent=action.summary||'';
  const acts=d.querySelector('.acts'),res=d.querySelector('.res'),[no,yes]=acts.querySelectorAll('button');let busy=false,finished=false;
  const show=(text,cls='')=>{acts.hidden=true;res.hidden=false;res.className='res '+cls;res.textContent=text;};
  const go=async decision=>{if(busy||finished)return;if(action.expiresAt&&now()>action.expiresAt){finished=true;show('This request expired. Ask again.','meta');return;}
    // Gmail is link-out: open the tab inside the tap so popup blockers allow it, then point it at the compose URL.
    const tab=decision==='approve'&&action.app==='gmail'?window.open('about:blank','_blank'):null;
    busy=true;yes.textContent=decision==='approve'?'Working…':yes.textContent;yes.disabled=no.disabled=true;if(decision==='approve')buzz(10);
    let r;try{r=await decideAction(getUser(),action.id,decision);}catch(e){r={state:e.status===404?'expired':'error'};}
    busy=false;yes.disabled=no.disabled=false;yes.textContent='Approve';
    const at=new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    if(r.state!=='done')tab?.close();
    if(r.state==='done'){finished=true;show(`✓ ${r.result?.summary||'Done'} · ${at}`,'ok');
      const gm=safeLink(r.result?.link,/^https:\/\/mail\.google\.com\//),mt=safeLink(r.result?.mailto,/^mailto:/);
      if(gm){if(tab)tab.location.href=gm;const p=document.createElement('p');p.className='res meta';p.innerHTML=`<a href="${esc(gm)}" target="_blank" rel="noopener">Open Gmail</a>${mt?` · <a href="${esc(mt)}">Mail app</a>`:''}`;res.after(p);}else tab?.close();}
    else if(r.state==='cancelled'){finished=true;show('Cancelled · nothing was sent','meta');}
    else if(r.state==='expired'){finished=true;show('This request expired. Ask again.','meta');}
    else if(r.state==='reauth'){res.hidden=false;res.className='res e';res.textContent=`Sign in to ${name} again in Me, then tap Approve.`;}
    else{res.hidden=false;res.className='res e';res.textContent="Couldn't do it. Nothing went out. Tap Approve to try again.";}};
  no.onclick=()=>go('cancel');yes.onclick=()=>go('approve');return d;}
export const isServerAction=a=>typeof a?.id==='string'&&/^act_[0-9a-f]{24}$/.test(a.id);

// Self-install: watch the Me sheet (#v4Me, rendered by v4.js) and add the Apps box before Privacy. No edits to v4.js.
export function install(doc=document){const me=doc.getElementById('v4Me');if(!me)return;
  const put=()=>{if(me.querySelector('#meApps'))return;const u=currentUser();if(!u||u.isAnonymous)return;
    const anchor=[...me.querySelectorAll('.capLbl')].find(n=>n.textContent==='Privacy');if(!anchor)return;
    const box=doc.createElement('div');box.id='meApps';box.hidden=true;anchor.before(box);renderApps(box,u);};
  new MutationObserver(put).observe(me,{childList:true});put();
  if(readReturn())setTimeout(()=>doc.getElementById('tabMe')?.click(),800);}
if(typeof document!=='undefined'&&!globalThis.__vwNoConnInstall){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>install());else install();}
