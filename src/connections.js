// Connect v1 (design/connect-v1-spec.md, docs/DESIGN.md "Connect apps API"): Apps section in Me + in-chat confirm card.
// Tokens never touch the browser. The proxy keeps them; this file only shows state and sends taps.
import {API} from './threads.js';
import {toast} from './ui.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const buzz=p=>{try{navigator.vibrate?.(p);}catch{/* no haptics */}};
const MARK={gdrive:'D',gcal:'C',gmail:'M',notion:'N',spotify:'S'};
async function call(user,path,init={}){const t=await user.getIdToken();const r=await fetch(API+path,{...init,headers:{...(init.headers||{}),Authorization:'Bearer '+t,...(init.body?{'Content-Type':'application/json'}:{})}});
  let j=null;try{j=await r.json();}catch{/* empty */}if(!r.ok){const e=new Error(j?.error||'failed');e.status=r.status;throw e;}return j;}
export const listApps=u=>call(u,'/apps');
export const decideAction=(u,id,decision)=>call(u,'/actions/'+encodeURIComponent(id),{method:'POST',body:JSON.stringify({decision})});
const STATE={connect:['Connect','c'],connected:['Connected','ok'],reauth:['Sign in again','e'],soon:['Coming soon','w'],connecting:['Connecting…','w'],error:['Try again','e']};
export function tileHtml(a){const [label,cls]=STATE[a.state]||STATE.soon;return `<button type="button" class="tile" data-app="${esc(a.id)}" data-state="${esc(a.state)}"${a.state==='soon'?' aria-disabled="true"':''}><span class="mk">${MARK[a.id]||esc(a.name[0])}</span><span class="tn">${esc(a.name)}</span><span class="st ${cls}">${label}</span></button>`;}

// Renders into box (a div in the Me sheet). Hidden when signed out/anonymous or the proxy has no /apps yet.
export async function renderApps(box,user){if(!box)return;box.hidden=true;if(!user||user.isAnonymous)return;
  let data;try{data=await listApps(user);}catch{return;}
  const apps=Array.isArray(data?.apps)?data.apps:[];if(!apps.length)return;
  const n=apps.filter(a=>a.state==='connected').length;
  box.innerHTML=`<div class="appsHd"><span class="cap">Apps</span><span class="meta">${n} of ${apps.length} connected</span></div><div class="appsList">${apps.map(tileHtml).join('')}</div><div class="appsAsk" hidden></div><p class="meta appsNote">Your agent always asks before it sends, pays or submits.</p>`;
  box.hidden=false;const ask=box.querySelector('.appsAsk');
  for(const b of box.querySelectorAll('.tile'))b.onclick=async()=>{const a=apps.find(x=>x.id===b.dataset.app);if(!a||a.state==='soon'){toast('Coming soon');return;}
    if(a.state==='connected'){ask.hidden=false;ask.innerHTML=`<p>Disconnect ${esc(a.name)}? Your agent loses access straight away.</p><div class="acts"><button type="button" class="ghost">Cancel</button><button type="button" class="primary">Disconnect</button></div>`;
      ask.querySelector('.ghost').onclick=()=>{ask.hidden=true;};
      ask.querySelector('.primary').onclick=async()=>{try{await call(user,'/apps/'+a.id,{method:'DELETE'});toast(`${a.name} disconnected`);}catch{toast("Couldn't disconnect. Try again.");}renderApps(box,user);};return;}
    const st=b.querySelector('.st');st.className='st w';st.textContent='Connecting…';
    try{const j=await call(user,'/apps/'+a.id+'/connect',{method:'POST'});if(j?.authUrl&&/^https:\/\/accounts\.google\.com\//.test(j.authUrl))location.href=j.authUrl;else throw new Error('no url');}
    catch(e){st.className='st e';st.textContent=e.status===503?'Coming soon':'Try again';}};}

// After the OAuth round trip the proxy sends us to #/me?app=<id>&result=ok|error. Returns {app,result} or null.
export function readReturn(loc=location){const m=/^#\/me\?(.*)$/.exec(loc.hash||'');if(!m)return null;const q=new URLSearchParams(m[1]);
  try{history.replaceState(null,'',loc.pathname+loc.search);}catch{/* ignore */}
  const r={app:q.get('app')||'',result:q.get('result')==='ok'?'ok':'error'};if(r.result==='ok')buzz([15,40,15]);toast(r.result==='ok'?'Connected':"Couldn't connect. Try again.");return r;}

// In-chat confirm card for one pending action {id, app, kind, title, summary, expiresAt}. Approve runs it once.
const APP_NAME={gdrive:'Google Drive',gcal:'Google Calendar',gmail:'Gmail'};
export function actionCard(action,getUser,now=()=>Date.now()){const d=document.createElement('div');d.className='msg bot actCard';
  const name=APP_NAME[action.app]||'App';
  d.innerHTML=`<div class="card"><div class="row"><span class="mk sm">${MARK[action.app]||'A'}</span><span class="cap">${esc(name)}</span></div><b class="ttl"></b><p class="sum meta"></p><div class="acts"><button type="button" class="ghost">Cancel</button><button type="button" class="primary">Approve</button></div><p class="res" hidden></p></div>`;
  d.querySelector('.ttl').textContent=action.title||'';d.querySelector('.sum').textContent=action.summary||'';
  const acts=d.querySelector('.acts'),res=d.querySelector('.res'),[no,yes]=acts.querySelectorAll('button');let busy=false,finished=false;
  const show=(text,cls='')=>{acts.hidden=true;res.hidden=false;res.className='res '+cls;res.textContent=text;};
  const go=async decision=>{if(busy||finished)return;if(action.expiresAt&&now()>action.expiresAt){finished=true;show('This request expired. Ask again.','meta');return;}
    busy=true;yes.textContent=decision==='approve'?'Working…':yes.textContent;yes.disabled=no.disabled=true;if(decision==='approve')buzz(10);
    let r;try{r=await decideAction(getUser(),action.id,decision);}catch(e){r={state:e.status===404?'expired':'error'};}
    busy=false;yes.disabled=no.disabled=false;yes.textContent='Approve';
    const at=new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    if(r.state==='done'){finished=true;show(`✓ ${r.result?.summary||'Done'} · ${at}`,'ok');}
    else if(r.state==='cancelled'){finished=true;show('Cancelled · nothing was sent','meta');}
    else if(r.state==='expired'){finished=true;show('This request expired. Ask again.','meta');}
    else if(r.state==='reauth'){res.hidden=false;res.className='res e';res.textContent=`Sign in to ${name} again in Me, then tap Approve.`;}
    else{res.hidden=false;res.className='res e';res.textContent="Couldn't do it. Nothing went out. Tap Approve to try again.";}};
  no.onclick=()=>go('cancel');yes.onclick=()=>go('approve');return d;}
export const isServerAction=a=>typeof a?.id==='string'&&/^act_[0-9a-f]{24}$/.test(a.id);
