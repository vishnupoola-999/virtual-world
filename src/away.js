// "While you were away" card (design/living-spec.md §3). Shown on app open when more than 30 min have passed since the
// last visit and the diary has 1+ new entries. The diary is owner-only; meeting partners appear only by the name stored on
// the entry (withName) and a hashed id (withId). Partner profiles are never looked up.
import {ICONS,LABEL,icon} from './interests.js';
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const AWAY_MS=30*60e3,SNOOZE_MS=7*864e5,LAST='vw-last-visit',DISMISS='vw-intro-dismissed';
const toDate=v=>v instanceof Date?v:typeof v?.toDate==='function'?v.toDate():typeof v==='number'||typeof v==='string'?new Date(v):v&&typeof v.seconds==='number'?new Date(v.seconds*1000):null;
const hhmm=d=>{let h=d.getHours()%12||12;return `${h}:${String(d.getMinutes()).padStart(2,'0')}`;};
const ampm=d=>d.toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit',hour12:true}).toLowerCase();
const tag=k=>ICONS[k]?`<span class="itag">${icon(k,12)}${LABEL[k]}</span>`:k?`<span class="itag">${esc(String(k).slice(0,16))}</span>`:'';
const likes=list=>list.map(k=>LABEL[k]||k).map(s=>String(s).toLowerCase()).join(' and ');
function dismissed(){try{return JSON.parse(localStorage.getItem(DISMISS)||'{}')||{};}catch{return {};}}
export const lastVisit=()=>+localStorage.getItem(LAST)||0;
export const markVisit=(t=Date.now())=>localStorage.setItem(LAST,String(t));

export function setupAway({agents,track=()=>{},toast=()=>{}}){let raf=0,open=false;
  const root=document.createElement('div');root.id='away';root.hidden=true;document.body.append(root);
  function close(how='close'){if(!open)return;open=false;cancelAnimationFrame(raf);root.hidden=true;root.innerHTML='';markVisit();if(how==='close')track('away_close');}
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&open)close();});
  // entries: [{at, kind:'meet'|'diary', text, withId, withName, shared}] newest last or first, any order.
  function render({name='Your agent',since,entries,friends={}}){
    const list=entries.map(e=>({...e,at:toDate(e.at)})).filter(e=>e.at&&!isNaN(e.at)).sort((a,b)=>a.at-b.at);
    const met=[];for(const e of list)if(e.kind==='meet'&&e.withId&&!met.some(m=>m.withId===e.withId))met.push(e);
    const things=list.filter(e=>e.kind!=='meet').length;const hours=Math.round((things*6+met.length*10)/6)/10;
    const shown=list.slice(-4);
    const line=e=>e.kind==='meet'?`Met <b>${esc(String(e.withName||'an agent').slice(0,40))}'s agent</b>.${Array.isArray(e.shared)&&e.shared.length?` You both like ${esc(likes(e.shared.slice(0,2)))}.`:''}`:esc(String(e.text||'').slice(0,140));
    const snooze=dismissed(),now=Date.now();
    const pick=met.find(m=>!(snooze[m.withId]>now));const f=pick&&friends[pick.withId]||{};
    const reason=pick?(f.bio?String(f.bio).slice(0,80):Array.isArray(pick.shared)&&pick.shared.length?`You both like ${likes(pick.shared.slice(0,2))}.`:'Your agents got along.'):'';
    const mono=(n,cls='')=>`<div class="aav mono ${cls}" aria-hidden="true">${esc(String(n||'?').trim()[0]||'?').toUpperCase()}</div>`;
    const sinceTxt=since?` · since ${ampm(toDate(since))}`:'';
    root.innerHTML=`<div class="scrim"></div><section class="card glass" role="dialog" aria-modal="true" aria-labelledby="awayT">
      <div class="ahd"><div class="aav"><canvas width="92" height="92" id="awayAv" aria-hidden="true"></canvas></div><div><h2 id="awayT">While you were away</h2><p>${esc(name)}${sinceTxt}</p></div>
        <button class="x" id="awayX" type="button" aria-label="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <div class="sum"><div><b>${met.length}</b><small>agents met</small></div><div><b>${things}</b><small>things done</small></div><div><b>${hours} h</b><small>saved for you</small></div></div>
      <div class="sec">Diary</div><ul class="diary">${shown.map(e=>`<li${e.kind==='meet'?' class="met"':''}><time>${hhmm(e.at)}</time><span class="d"></span><span>${line(e)}</span></li>`).join('')}</ul>
      ${met.length?`<div class="sec">Agents ${esc(name)} met</div><div class="met-row">${met.slice(0,3).map(m=>`<button class="mcard" type="button" data-id="${esc(m.withId)}">${mono(m.withName)}<b>${esc(String(m.withName||'Agent').slice(0,24))}</b>${tag(Array.isArray(m.shared)?m.shared[0]:'')}</button>`).join('')}</div>`:''}
      ${pick?`<div class="intro" id="awayIntro"><div class="irow">${mono(pick.withName)}<p><b>Intro you to ${esc(String(pick.withName).slice(0,24))}?</b> ${esc(reason)}</p></div>
        <div class="acts"><button class="secondary" id="introNo" type="button">Not now</button><button class="brand" id="introYes" type="button">Intro</button></div></div>`:''}
    </section>`;
    $('awayX').onclick=()=>close();root.querySelector('.scrim').onclick=()=>close();
    root.querySelectorAll('.mcard').forEach(b=>b.onclick=()=>{track('away_agent_tap');const fr=friends[b.dataset.id];toast(fr?.note?String(fr.note).slice(0,140):`${b.querySelector('b').textContent}'s agent`,5000);});
    if(pick){$('introNo').onclick=()=>{const d=dismissed();d[pick.withId]=Date.now()+SNOOZE_MS;for(const k in d)if(d[k]<Date.now())delete d[k];localStorage.setItem(DISMISS,JSON.stringify(d));track('intro_dismiss');$('awayIntro').hidden=true;};
      // Intro requests need a backend endpoint (mutual opt-in); until then this records intent and says so honestly.
      $('introYes').onclick=()=>{track('intro_accept');$('awayIntro').hidden=true;toast(`Intros are coming soon. We'll remember you'd like to meet ${String(pick.withName).slice(0,24)}.`,5000);};}
    track('away_card_view',{entries:list.length,met:met.length});
    // Live waving avatar: the shared map renderer's portrait view, ~30 fps, only while the card is open.
    const cv=$('awayAv');let last=0,start=performance.now();
    const loop=t=>{if(!open)return;raf=requestAnimationFrame(loop);if(document.hidden||t-last<33)return;const dt=last?Math.min(.1,(t-last)/1000):0;last=t;
      agents.portrait("me",cv,t-start<2300?"wave":"idle",dt);};raf=requestAnimationFrame(loop);}
  return {
    // Shows the card when due. entries: all diary entries the owner can read. Returns true if shown.
    maybeShow({name,entries,friends,force=false}){const lv=lastVisit(),now=Date.now();if(!force&&(!lv||now-lv<=AWAY_MS)){markVisit();return false;}
      const fresh=(entries||[]).filter(e=>{const d=toDate(e.at);return d&&(force||d.getTime()>lv);});
      if(!fresh.length){markVisit();return false;}open=true;root.hidden=false;render({name,since:lv?new Date(lv):null,entries:fresh,friends});return true;},
    close,get open(){return open;}};}
