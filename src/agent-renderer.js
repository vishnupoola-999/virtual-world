// World v2: ONE shared offscreen three.js renderer for every agent on the map (design/world-v2-spec.md §b).
// Each agent keeps its own small scene; draw() renders it at the marker's CSS size (84×96) times the pixel ratio
// (min(devicePixelRatio, 3), stepped down only if the map loop falls below 30 fps) and returns the canvas so the caller can
// drawImage() it 1:1 into that marker's 2D canvas. One WebGL context besides the map, whatever the agent count.
import * as THREE from 'three';
import {createCharacter} from './character.js';
export const CSS_W=84,CSS_H=96;
export const basePR=()=>Math.min(Math.max(1,globalThis.devicePixelRatio||1),3); // full device pixels (84x96 CSS markers are cheap even at 3x)
const W=CSS_W,H=CSS_H;
export function sharedRenderer(){
  const r=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});
  let pr=basePR();r.setPixelRatio(pr);r.setSize(W,H,false);r.setClearColor(0x000000,0);
  // Map camera: creatures are <=1.0 m tall and <=0.95 m wide (character.js SCALE); frames -0.05..1.37 m so the happy hop
  // (+0.17 m), Sprout's leaf and Drip's tip never touch the top edge.
  const cam=new THREE.PerspectiveCamera(24,W/H,.1,10);cam.position.set(0,.66,3.3);cam.lookAt(0,.64,0);
  // Portrait camera for the profile sheet: the whole creature is the face, so frame all of it (leaf and tip uncropped).
  const portrait=new THREE.PerspectiveCamera(24,W/H,.1,10);portrait.position.set(0,.56,3.05);portrait.lookAt(0,.52,0);
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
    drop(id){const s=scenes.get(id);if(!s)return;s.sc.traverse(o=>{if(o.isMesh&&!o.geometry.userData.shared)o.geometry.dispose();});scenes.delete(id);},
    // Buffer size in device pixels (CSS size × pixel ratio); the marker canvases match it so nothing is upscaled.
    get size(){return [Math.round(W*pr),Math.round(H*pr)];},get pixelRatio(){return pr;},get antialias(){return r.getContextAttributes()?.antialias===true;},
    setPixelRatio(p){if(p===pr)return;pr=p;r.setPixelRatio(pr);r.setSize(W,H,false);}};}
