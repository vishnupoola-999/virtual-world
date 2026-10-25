// World v2: ONE shared offscreen three.js renderer for every agent on the map (design/world-v2-spec.md §b).
// Each agent keeps its own small scene; draw() renders it at the marker's CSS size (84×96) times the pixel ratio
// (min(devicePixelRatio, 2), dropped to 1.5 by the frame-time monitor) and returns the canvas so the caller can
// drawImage() it 1:1 into that marker's 2D canvas. One WebGL context besides the map, whatever the agent count.
import * as THREE from 'three';
import {createCharacter} from './character.js';
export const CSS_W=84,CSS_H=96;
export const basePR=()=>Math.min(Math.max(1,globalThis.devicePixelRatio||1),2);
const W=CSS_W,H=CSS_H;
export function sharedRenderer(){
  const r=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});
  let pr=basePR();r.setPixelRatio(pr);r.setSize(W,H,false);r.setClearColor(0x000000,0);
  // Map camera: the frustum used to stop at y≈1.03 m while the hair top is at ≈1.29 m, so the top of every head was cut off.
  // Now frames -0.05…1.42 m (feet, hair, wave arm and the walk hop) with headroom.
  const cam=new THREE.PerspectiveCamera(24,W/H,.1,10);cam.position.set(0,.70,3.45);cam.lookAt(0,.68,0);
  // Portrait camera for the profile sheet: head and shoulders with headroom.
  const portrait=new THREE.PerspectiveCamera(24,W/H,.1,10);portrait.position.set(0,1.12,2.2);portrait.lookAt(0,1.08,0);
  const scenes=new Map();
  function scene(id,look){let s=scenes.get(id);if(s)return s;
    const sc=new THREE.Scene();sc.add(new THREE.HemisphereLight('#dfe6ff','#2a2040',1.8));
    const k=new THREE.DirectionalLight('#fff3e0',2);k.position.set(2,3,3);sc.add(k);
    const rim=new THREE.DirectionalLight('#8b7bff',1.4);rim.position.set(-2,2,-2);sc.add(rim);
    const soft=new THREE.DirectionalLight('#cfe0ff',.6);soft.position.set(2.5,1.6,-2.5);sc.add(soft); // soft rim from the other side
    const c=createCharacter(look);c.group.rotation.y=-.3;sc.add(c.group);
    s={sc,c,key:JSON.stringify(look),anim:'idle'};scenes.set(id,s);return s;}
  return {
    // look: a sanitized look; anim: idle | walk | talk | wave; dt in seconds (0 for a static frame)
    draw(id,look,anim,dt,view,yaw){const s=scene(id,look),key=JSON.stringify(look);
      if(key!==s.key){s.key=key;s.c.setLook(look);}
      if(anim!==s.anim){s.anim=anim;s.c.play(anim);}
      s.c.group.rotation.y=view==='portrait'?-.3:(typeof yaw==='number'?yaw:-.3); // living states: two meeting agents face each other
      s.c.update(dt);r.render(s.sc,view==='portrait'?portrait:cam);return r.domElement;},
    drop(id){const s=scenes.get(id);if(!s)return;s.sc.traverse(o=>{if(o.isMesh)o.geometry.dispose();});scenes.delete(id);},
    // Buffer size in device pixels (CSS size × pixel ratio); the marker canvases match it so nothing is upscaled.
    get size(){return [Math.round(W*pr),Math.round(H*pr)];},get pixelRatio(){return pr;},get antialias(){return r.getContextAttributes()?.antialias===true;},
    setPixelRatio(p){if(p===pr)return;pr=p;r.setPixelRatio(pr);r.setSize(W,H,false);}};}
