// Small three.js view of the agent character at the top of the Chat tab (same look as on the map).
// Cheap on low-end phones: own small canvas, pixelRatio 1 (perf audit #4), ~30 fps while animating and ~15 fps when idle,
// fully paused while the World tab is open or the app is in the background.
import * as THREE from 'three';
import {createCharacter} from './character.js';
import {toLook} from './character-data.js';
import {LOW_END} from './device.js';
const REDUCED=matchMedia('(prefers-reduced-motion: reduce)');
export function chatHero(canvas){let lastAgent=null;const ro=new ResizeObserver(()=>size());
  let r=null,scene,cam,ch,raf=0,last=0,active=false,busyUntil=0,key='',state='idle',stateT=0;const clock=new THREE.Clock();
  function init(){if(r)return true;
    try{r=new THREE.WebGLRenderer({canvas,antialias:!LOW_END,alpha:true,powerPreference:'low-power'});}catch(e){console.warn('hero webgl',e?.message);return false;}
    r.setPixelRatio(1);scene=new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff,0x334466,2.2));const d=new THREE.DirectionalLight(0xffffff,2);d.position.set(2,4,5);scene.add(d);
    const rim=new THREE.DirectionalLight('#5eb4ff',1.4);rim.position.set(-2,3,-4);scene.add(rim);
    cam=new THREE.PerspectiveCamera(28,1,.1,10);cam.position.set(0,.62,3.4);cam.lookAt(0,.56,0);
    ch=createCharacter();scene.add(ch.group);size();return true;}
  function size(){if(!r)return;const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;r.setSize(w,h,false);cam.aspect=w/h;
    // UI v2: the header avatar is a 44 px circle, so frame head and shoulders instead of the whole body.
    if(w<80){cam.position.set(0,.86,1.75);cam.lookAt(0,.8,0);}else{cam.position.set(0,.62,3.4);cam.lookAt(0,.56,0);}cam.updateProjectionMatrix();draw();}
  function draw(){if(!r||!ch)return;ch.update(Math.min(clock.getDelta(),.1));
    // thinking: gentle side-to-side sway; sleeping: dimmed and sinks a little; error: still.
    const T=performance.now()/1000,g=ch.group;g.rotation.y=state==='thinking'?Math.sin(T*3)*.35:0;
    g.position.y=state==='sleeping'?-.03+Math.sin(T*1.2)*.01:0;canvas.style.opacity=state==='sleeping'?.7:1;r.render(scene,cam);}
  function frame(t){raf=0;if(!active||document.hidden)return;
    const busy=t<busyUntil||state==='thinking'||state==='sleeping';if(REDUCED.matches&&!busy){draw();return;}
    if(t-last>=(busy?33:66)){last=t;draw();}raf=requestAnimationFrame(frame);}
  const kick=()=>{if(active&&!raf&&!document.hidden&&init())raf=requestAnimationFrame(frame);};
  ro.observe(canvas);
  // Free the GPU context when leaving Chat; a fresh canvas + renderer is made on the next start.
  function release(){if(!r)return;ch.group.traverse(o=>{if(o.isMesh)o.geometry.dispose();});r.dispose();r.forceContextLoss();r=null;ch=null;key='';
    const c=canvas.cloneNode(false);ro.unobserve(canvas);canvas.replaceWith(c);canvas=c;ro.observe(c);}
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){clock.getDelta();kick();}});
  return {
    set(agent){lastAgent=agent;if(!agent||!init())return;const l=toLook(agent.look,agent.ownerName||agent.name),k=JSON.stringify(l);if(k!==key){key=k;ch.setLook(l);draw();}},
    start(){active=true;clock.getDelta();if(!r&&lastAgent)this.set(lastAgent);kick();},
    stop(){active=false;if(raf)cancelAnimationFrame(raf);raf=0;release();},
    // idle | thinking | talking | sleeping | error
    state(s){state=s;stateT=performance.now();if(!ch)return;
      if(s==='talking'){ch.play('talk');busyUntil=stateT+1200;setTimeout(()=>{if(state==='talking'){ch.play('idle');state='idle';}},1200);}
      else if(s==='wave'){ch.play('wave');state='idle';busyUntil=stateT+2300;}
      else ch.play('idle');kick();}};}
