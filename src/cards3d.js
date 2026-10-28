// three.js renderers for the creature picker (onboarding cards + agent-sheet thumbnails). Lazy-loaded so three.js stays off the startup path.
import * as THREE from 'three';
import {createCharacter} from './character.js';
import {CREATURES} from './character-data.js';
const cardCam=(aspect)=>{const c=new THREE.PerspectiveCamera(30,aspect,.1,10);c.position.set(0,.55,2.7);c.lookAt(0,.48,0);return c;};
const thumbCache=new Map();
// One-off snapshots of the six creatures for the agent-sheet picker (one renderer, disposed right after).
// color (optional '#rrggbb') recolours every body for the colour preview; one cached set per colour.
export function cardThumbs(color=null){const key=color||'';let thumbs=thumbCache.get(key);if(thumbs)return thumbs;thumbs={};if(thumbCache.size>12)thumbCache.delete(thumbCache.keys().next().value);thumbCache.set(key,thumbs);
  try{const r=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});r.setPixelRatio(Math.min(devicePixelRatio||1,2));r.setSize(96,120);
    const scene=new THREE.Scene(),cam=cardCam(96/120);
    for(const c of CREATURES){const ch=createCharacter({creature:c,accessory:'none',...(color?{color}:{})});ch.group.rotation.y=-.25;scene.add(ch.group);ch.update(0);r.render(scene,cam);thumbs[c]=r.domElement.toDataURL('image/png');scene.remove(ch.group);ch.dispose();}
    r.dispose();r.forceContextLoss?.();}catch(e){console.warn('picker thumbs',e?.message);}
  return thumbs;}
// One renderer draws every picker card (scissor + viewport per button), ~30 fps while something moves, then stops.
// btns[i].dataset.creature names the creature; setAccessory() previews the accessory on all six.
export function cardRenderer(canvas,btns){let r;try{r=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'low-power'});}catch(e){console.warn('cards webgl',e?.message);return null;}
  r.setPixelRatio(Math.min(devicePixelRatio||1,2));r.setScissorTest(true);
  const scenes=btns.map(b=>{const s=new THREE.Scene();const ch=createCharacter({creature:b.dataset.creature,accessory:'none'});ch.group.rotation.y=-.25;s.add(ch.group);return {c:b.dataset.creature,s,ch};});
  const cam=cardCam(.8);const clock=new THREE.Clock();let raf=0,last=0,busy=0;
  function draw(){const W=canvas.clientWidth,H=canvas.clientHeight;if(!W||!H)return;r.setSize(W,H,false);const cr=canvas.getBoundingClientRect();
    const dt=Math.min(clock.getDelta(),.1);
    for(let i=0;i<scenes.length;i++){const br=btns[i].getBoundingClientRect(),x=br.left-cr.left,y=H-(br.bottom-cr.top),w=br.width,h=br.height;
      r.setViewport(x,y,w,h);r.setScissor(x,y,w,h);cam.aspect=w/h;cam.updateProjectionMatrix();scenes[i].ch.update(dt);r.render(scenes[i].s,cam);}}
  function loop(t){raf=requestAnimationFrame(loop);if(document.hidden||t-last<33)return;last=t;draw();if(performance.now()>busy&&last>0){cancelAnimationFrame(raf);raf=0;}}
  const kick=ms=>{busy=Math.max(busy,performance.now()+ms);if(!raf)raf=requestAnimationFrame(loop);};
  const ro=new ResizeObserver(()=>kick(100));ro.observe(canvas);kick(300);
  return {wave(c){const sc=scenes.find(s=>s.c===c);sc?.ch.play('happy');kick(2500);},
    setAccessory(a){for(const s of scenes)s.ch.setLook({creature:s.c,accessory:a});kick(300);},
    dispose(){cancelAnimationFrame(raf);ro.disconnect();for(const s of scenes)s.ch.dispose();r.dispose();r.forceContextLoss?.();}};}
// v4: a portrait of any saved look (creature + accessory + body colour), optionally turned to face left or right.
// One small renderer, kept for the session; results cached per look key (data: URLs). DPR capped at 2 for cheap phones.
let pr=null;const faceCache=new Map();
export function lookThumb(look,{face=0,size=88}={}){const l=look||{creature:'blob',accessory:'none'};const key=[l.creature,l.accessory,l.color||'',face,size].join('|');
  const hit=faceCache.get(key);if(hit)return hit;
  try{if(!pr){const r=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true,powerPreference:'low-power'});r.setPixelRatio(Math.min(devicePixelRatio||1,2));pr={r,scene:new THREE.Scene(),cam:new THREE.PerspectiveCamera(30,1,.1,10)};pr.cam.position.set(0,.5,2.55);pr.cam.lookAt(0,.47,0);}
    const {r,scene,cam}=pr;r.setSize(size,size);const ch=createCharacter(l);ch.group.rotation.y=face*.55-(face?0:.2);scene.add(ch.group);ch.update(0);r.render(scene,cam);
    const url=r.domElement.toDataURL('image/png');scene.remove(ch.group);ch.dispose();if(faceCache.size>80)faceCache.delete(faceCache.keys().next().value);faceCache.set(key,url);return url;}
  catch(e){console.warn('lookThumb',e?.message);return '';}}
