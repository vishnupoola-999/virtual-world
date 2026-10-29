// Time in app: a non-visual heartbeat to the proxy (POST /me/usage) about every 60s while the page is visible.
// Sends only a duration, a new-session flag and the current tab name; never any content.
import {onUser} from './firebase.js';
const URL_='https://virtual-world-ai.onrender.com/me/usage',GAP=30*60e3;
export function setupUsage(){
  let user=null,since=0,newSession=true,hiddenAt=0;
  const send=(beacon)=>{
    if(!user||!since)return;const now=Date.now(),seconds=Math.min(120,Math.round((now-since)/1000));since=document.hidden?0:now;
    if(seconds<1&&!newSession)return;const body={seconds,newSession,screen:document.body.dataset.tab||''};newSession=false;
    user.getIdToken().then(t=>fetch(URL_,{method:'POST',keepalive:!!beacon,headers:{Authorization:`Bearer ${t}`,'Content-Type':'application/json'},body:JSON.stringify(body)})).catch(()=>{});
  };
  onUser(u=>{if(user&&user!==u)send(true);user=u;newSession=true;since=u&&!document.hidden?Date.now():0;});
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){hiddenAt=Date.now();send(true);}
    else{if(hiddenAt&&Date.now()-hiddenAt>GAP)newSession=true;since=Date.now();}
  });
  addEventListener('pagehide',()=>send(true));
  setInterval(()=>{if(!document.hidden)send();},60e3);
}
