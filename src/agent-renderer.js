// World v2: ONE shared offscreen three.js renderer for every agent on the map (design/world-v2-spec.md §b).
// Each agent keeps its own small scene; draw() renders it at 112×128 (pixelRatio 1) and returns the canvas so the
// caller can drawImage() it into that marker's 2D canvas. One WebGL context besides the map, whatever the agent count.
import * as THREE from 'three';
import {createCharacter} from './character.js';
import {LOW_END} from './device.js';
const W=112,H=128;
export function sharedRenderer(){
  const r=new THREE.WebGLRenderer({antialias:!LOW_END,alpha:true,powerPreference:'low-power'});
  r.setPixelRatio(1);r.setSize(W,H,false);r.setClearColor(0x000000,0);
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
    const c=createCharacter(look);c.group.rotation.y=-.3;sc.add(c.group);
    s={sc,c,key:JSON.stringify(look),anim:'idle'};scenes.set(id,s);return s;}
  return {
    // look: a sanitized look; anim: idle | walk | talk | wave; dt in seconds (0 for a static frame)
    draw(id,look,anim,dt,view){const s=scene(id,look),key=JSON.stringify(look);
      if(key!==s.key){s.key=key;s.c.setLook(look);}
      if(anim!==s.anim){s.anim=anim;s.c.play(anim);}
      s.c.update(dt);r.render(s.sc,view==='portrait'?portrait:cam);return r.domElement;},
    drop(id){const s=scenes.get(id);if(!s)return;s.sc.traverse(o=>{if(o.isMesh)o.geometry.dispose();});scenes.delete(id);},
    get size(){return [W,H];}};}
