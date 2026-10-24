// Mobile-first shell: full-screen map, floating buttons, one dismissible bottom sheet (side panel on desktop), toasts.
const $=id=>document.getElementById(id);
let cur=null;
export function openSheet(sec){const s=$('sheet');
  if(cur===sec&&!s.hidden)return closeSheet();if(sec!=='agent')document.dispatchEvent(new Event('vw-agent-sheet-leave'));cur=sec;s.hidden=false;document.body.classList.add('sheet-open');
  for(const el of s.querySelectorAll('[data-sec]'))el.hidden=el.dataset.sec!==sec;
  for(const b of document.querySelectorAll('.fab[data-open]'))b.classList.toggle('on',b.dataset.open===sec);
  $('sheetTitle').textContent=s.querySelector(`[data-sec="${sec}"]`)?.dataset.title||'';
  if(sec==='search')setTimeout(()=>$('q').focus({preventScroll:true}),50);}
export function closeSheet(){document.dispatchEvent(new Event('vw-agent-sheet-leave'));$('sheet').hidden=true;document.body.classList.remove('sheet-open');cur=null;for(const b of document.querySelectorAll('.fab'))b.classList.remove('on');}
let tt;export function toast(t,ms=3500){const el=$('toast');el.textContent=t;el.hidden=!t;clearTimeout(tt);if(t&&ms)tt=setTimeout(()=>el.hidden=true,ms);}
export function setupUI(){
  for(const b of document.querySelectorAll('[data-open]'))b.onclick=()=>openSheet(b.dataset.open);
  $('sheetClose').onclick=closeSheet;
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSheet();});
  // swipe the grabber down to dismiss
  let y0=null;const g=$('sheetHead');
  g.addEventListener('touchstart',e=>y0=e.touches[0].clientY,{passive:true});
  g.addEventListener('touchend',e=>{if(y0!==null&&e.changedTouches[0].clientY-y0>50)closeSheet();y0=null;});
  $('toast').onclick=()=>toast('');
}
