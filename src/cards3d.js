// three.js renderers for the character picker (onboarding cards + agent-sheet thumbnails). Lazy-loaded so three.js stays off the startup path.
import * as THREE from 'three';
import {createCharacter} from './character.js';
import {defaultLook} from './character-data.js';
let thumbs=null;
// One-off snapshots of the two default characters for the picker cards (one renderer, disposed right after).
export function cardThumbs(){if(thumbs)return thumbs;thumbs={};
  try{const r=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});r.setPixelRatio(Math.min(devicePixelRatio||1,1.5));r.setSize(150,190);
    const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x334466,2.2));const d=new THREE.DirectionalLight(0xffffff,2);d.position.set(2,4,5);scene.add(d);
    const rim=new THREE.DirectionalLight('#5eb4ff',1.4);rim.position.set(-2,3,-4);scene.add(rim);
    const cam=new THREE.PerspectiveCamera(30,150/190,.1,10);cam.position.set(0,.55,3.2);cam.lookAt(0,.5,0);
    for(const b of ['girl','boy']){const ch=createCharacter(defaultLook(b));scene.add(ch.group);r.render(scene,cam);thumbs[b]=r.domElement.toDataURL('image/png');scene.remove(ch.group);ch.dispose?.();}
    r.dispose();r.forceContextLoss?.();}catch(e){console.warn('picker thumbs',e?.message);}
  return thumbs;}
// Shared renderer for the two picker cards.
export function cardRenderer(canvas,btns){let r;try{r=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'low-power'});}catch(e){console.warn('cards webgl',e?.message);return null;}
  r.setPixelRatio(Math.min(devicePixelRatio||1,1.5));r.setScissorTest(true);
  const scenes=['girl','boy'].map(b=>{const s=new THREE.Scene();s.add(new THREE.HemisphereLight(0xffffff,0x334466,2.2));const d=new THREE.DirectionalLight(0xffffff,2);d.position.set(2,4,5);s.add(d);
    const rim=new THREE.DirectionalLight('#5eb4ff',1.4);rim.position.set(-2,3,-4);s.add(rim);const ch=createCharacter(defaultLook(b));s.add(ch.group);return {b,s,ch};});
  const cam=new THREE.PerspectiveCamera(30,.8,.1,10);cam.position.set(0,.55,3.2);cam.lookAt(0,.5,0);
  const clock=new THREE.Clock();let raf=0,last=0,busy=0;
  function draw(){const W=canvas.clientWidth,H=canvas.clientHeight;if(!W||!H)return;r.setSize(W,H,false);const cr=canvas.getBoundingClientRect();
    const dt=Math.min(clock.getDelta(),.1);
    for(let i=0;i<2;i++){const br=btns[i].getBoundingClientRect(),x=br.left-cr.left,y=H-(br.bottom-cr.top),w=br.width,h=br.height;
      r.setViewport(x,y,w,h);r.setScissor(x,y,w,h);cam.aspect=w/h;cam.updateProjectionMatrix();scenes[i].ch.update?.(dt);r.render(scenes[i].s,cam);}}
  function loop(t){raf=requestAnimationFrame(loop);if(document.hidden||t-last<33)return;last=t;draw();if(performance.now()>busy&&last>0){cancelAnimationFrame(raf);raf=0;}}
  const kick=ms=>{busy=Math.max(busy,performance.now()+ms);if(!raf)raf=requestAnimationFrame(loop);};
  const ro=new ResizeObserver(()=>kick(100));ro.observe(canvas);kick(300);
  return {wave(b){const sc=scenes.find(s=>s.b===b);sc?.ch.play?.('wave');kick(2500);},
    dispose(){cancelAnimationFrame(raf);ro.disconnect();for(const s of scenes)s.s.traverse(o=>{if(o.isMesh)o.geometry.dispose();});r.dispose();r.forceContextLoss?.();}};}
