// Mobile-first shell: full-screen map, floating buttons, one dismissible bottom sheet (side panel on desktop), toasts.
const $=id=>document.getElementById(id);
let cur=null;
export function openSheet(sec){const s=$('sheet');
  if(cur===sec&&!s.hidden)return closeSheet();if(sec!=='agent')document.dispatchEvent(new Event('vw-agent-sheet-leave'));cur=sec;s.hidden=false;$('scrim').hidden=false;document.body.classList.add('sheet-open');
  for(const el of s.querySelectorAll('[data-sec]'))el.hidden=el.dataset.sec!==sec;
  for(const b of document.querySelectorAll('.fab[data-open]'))b.classList.toggle('on',b.dataset.open===sec);
  $('sheetTitle').textContent=s.querySelector(`[data-sec="${sec}"]`)?.dataset.title||'';
  if(sec==='search')setTimeout(()=>$('q').focus({preventScroll:true}),50);}
export function closeSheet(){document.dispatchEvent(new Event('vw-agent-sheet-leave'));$('sheet').hidden=true;$('scrim').hidden=true;document.body.classList.remove('sheet-open');cur=null;for(const b of document.querySelectorAll('.fab'))b.classList.remove('on');}
let tt;export function toast(t,ms=2400){const el=$('toast');el.textContent=t;el.hidden=!t;clearTimeout(tt);if(t&&ms)tt=setTimeout(()=>el.hidden=true,ms);}
export function setupUI(){
  for(const b of document.querySelectorAll('[data-open]'))b.onclick=()=>openSheet(b.dataset.open);
  $('sheetClose').onclick=closeSheet;$('scrim').onclick=closeSheet;
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSheet();});
  dragToClose($('sheet'),closeSheet);
  $('toast').onclick=()=>toast('');
}
// Drag a sheet down to dismiss it (every sheet: map sheets, the chat agent sheet, the World profile sheet).
// The sheet follows the finger with transform only; past 60 px it closes, otherwise it springs back.
// Drags that start inside scrolled content are left to the scroll.
export function dragToClose(sheet,close){let y0=null,dy=0;
  const scrolled=t=>{for(let n=t;n&&n!==sheet;n=n.parentElement)if(n.scrollTop>0)return true;return false;};
  sheet.addEventListener('touchstart',e=>{if(e.touches.length!==1||scrolled(e.target))return;y0=e.touches[0].clientY;dy=0;},{passive:true});
  sheet.addEventListener('touchmove',e=>{if(y0===null)return;dy=Math.max(0,e.touches[0].clientY-y0);if(dy>4){sheet.style.transition='none';sheet.style.transform=`translateY(${dy}px)`;}},{passive:true});
  const end=()=>{if(y0===null)return;y0=null;sheet.style.transition='';
    if(dy>60){close();requestAnimationFrame(()=>{sheet.style.transform='';});}else sheet.style.transform='';dy=0;};
  sheet.addEventListener('touchend',end);sheet.addEventListener('touchcancel',end);}
