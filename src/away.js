// "While you were away" card (design/living-spec.md §3). Shown on app open when more than 30 min have passed since the
// last visit and the diary has 1+ new entries. The diary is owner-only; meeting partners appear only by the name stored on
// the entry (withName) and a hashed id (withId). Partner profiles are never looked up.
import {ICONS,LABEL,icon} from './interests.js';
import {displayName as dn} from './names.js';
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const AWAY_MS=30*60e3,LAST='vw-last-visit';
const toDate=v=>v instanceof Date?v:typeof v?.toDate==='function'?v.toDate():typeof v==='number'||typeof v==='string'?new Date(v):v&&typeof v.seconds==='number'?new Date(v.seconds*1000):null;
const hhmm=d=>{let h=d.getHours()%12||12;return `${h}:${String(d.getMinutes()).padStart(2,'0')}`;};
const ampm=d=>d.toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit',hour12:true}).toLowerCase();
const tag=k=>ICONS[k]?`<span class="itag">${icon(k,12)}${LABEL[k]}</span>`:k?`<span class="itag">${esc(String(k).slice(0,16))}</span>`:'';
const likes=list=>list.map(k=>LABEL[k]||k).map(s=>String(s).toLowerCase()).join(' and ');
export const lastVisit=()=>+localStorage.getItem(LAST)||0;
export const markVisit=(t=Date.now())=>localStorage.setItem(LAST,String(t));

export function setupAway({track=()=>{}}={}){let open=false;
  const root=document.createElement('div');root.id='away';root.hidden=true;document.body.append(root);
  function close(how='close'){if(!open)return;open=false;root.hidden=true;root.innerHTML='';markVisit();if(how==='close')track('away_close');}
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&open)close();});
  // entries: [{at, kind:'meet'|'diary', text, withId, withName, shared}] newest last or first, any order.
  function render({name="Your agent",since,entries}){
    const list=entries.map(e=>({...e,at:toDate(e.at)})).filter(e=>e.at&&!isNaN(e.at)).sort((a,b)=>a.at-b.at);
    const met=[];for(const e of list)if(e.kind==='meet'&&e.withId&&!met.some(m=>m.withId===e.withId))met.push(e);
    // V1: a plain list. Diary lines, then who the agent met (gradient initial + stored name). No stats, no intro (post-V1).
    const shown=list.slice(-8);
    const line=e=>e.kind==='meet'?`Met <b>${esc(String(dn(e.withName)||'an agent').slice(0,40))}'s agent</b>.${Array.isArray(e.shared)&&e.shared.length?` You both like ${esc(likes(e.shared.slice(0,2)))}.`:''}`:esc(String(e.text||'').slice(0,140));
    const mono=n=>`<div class="aav mono" aria-hidden="true">${esc(String(n||'?').trim()[0]||'?').toUpperCase()}</div>`;
    const sinceTxt=since?` · since ${ampm(toDate(since))}`:'';
    root.innerHTML=`<div class="scrim"></div><section class="card glass v1" role="dialog" aria-modal="true" aria-labelledby="awayT">
      <div class="ahd"><div><h2 id="awayT">While you were away</h2><p>${esc(name)}${sinceTxt}</p></div>
        <button class="x" id="awayX" type="button" aria-label="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <div class="sec">Diary</div><ul class="diary">${shown.map(e=>`<li${e.kind==='meet'?' class="met"':''}><time>${hhmm(e.at)}</time><span class="d"></span><span>${line(e)}</span></li>`).join('')}</ul>
      ${met.length?`<div class="sec">Who ${esc(name)} met</div><ul class="met-list">${met.slice(0,6).map(m=>`<li>${mono(dn(m.withName))}<b>${esc(String(dn(m.withName)||'Agent').slice(0,24))}</b>${tag(Array.isArray(m.shared)?m.shared[0]:'')}</li>`).join('')}</ul>`:''}
    </section>`;
    $('awayX').onclick=()=>close();root.querySelector('.scrim').onclick=()=>close();
    track('away_card_view',{entries:list.length,met:met.length});
}
  return {
    // Shows the card when due. entries: all diary entries the owner can read. Returns true if shown.
    maybeShow({name,entries,force=false}){const lv=lastVisit(),now=Date.now();if(!force&&(!lv||now-lv<=AWAY_MS)){markVisit();return false;}
      const fresh=(entries||[]).filter(e=>{const d=toDate(e.at);return d&&(force||d.getTime()>lv);});
      if(!fresh.length){markVisit();return false;}open=true;root.hidden=false;render({name,since:lv?new Date(lv):null,entries:fresh});return true;},
    close,get open(){return open;}};}
