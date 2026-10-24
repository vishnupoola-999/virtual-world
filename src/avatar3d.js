// The user's agent as an animated 3D character standing on the map (MapLibre custom layer rendered by three.js).
// Character: procedural girl/boy bases from src/character.js (our own code, no external model or textures).
import * as THREE from 'three';
import {createCharacter,defaultLook,guessBase,sanitize} from './character.js';
const MIN_PX=56;      // character is never drawn smaller than this on screen…
const REAL_H=2.2;     // …and never smaller than ~2.2 m in the world
const HEX=/^#[0-9a-f]{6}$/i;
// Agents saved before v1 looks only have {color,emoji}: start from the name's default base and keep their colour as the outfit.
export function toLook(look,name=''){
  if(look?.v===1&&(look.base==='girl'||look.base==='boy'))return sanitize({...defaultLook(look.base),...look});
  const l=defaultLook(guessBase(name).base);if(HEX.test(look?.color||''))l.outfitColour=look.color.toLowerCase();return l;}
export function avatarLayer(map){
  let agent=null,renderer,scene,camera,model,ch=null,baseH=1,waved=false;const clock=new THREE.Clock();
  const label=document.createElement('div');label.className='agLabel';label.hidden=true;map.getContainer().appendChild(label);
  let topPx=null,elevC=null,raf=0,lastT=0;const M=new THREE.Matrix4(),MM=new THREE.Matrix4(),SM=new THREE.Matrix4(),V=new THREE.Vector4();
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){clock.getDelta();map.triggerRepaint();}});
  const mpp=()=>40075016.686*Math.cos(agent.lat*Math.PI/180)/(512*2**map.getZoom());
  const sizeM=()=>Math.max(REAL_H,MIN_PX*mpp());
  // Bounds checks are unreliable on a pitched globe and made the character blink; the GPU clips it off-screen anyway.
  const visible=()=>agent&&model&&map.getZoom()>=10;
  const onScreen=()=>{const q=map.project([agent.lon,agent.lat]),c=map.getCanvas(),m=200;return q.x>-m&&q.y>-m&&q.x<c.clientWidth+m&&q.y<c.clientHeight+m;};
  // Terrain tiles load and unload while the camera moves, so elevation briefly reads 0 and the character sank under the ground. Keep the last good value.
  const elevation=()=>{const e=map.queryTerrainElevation?.([agent.lon,agent.lat]);if(e!=null&&isFinite(e)&&(e!==0||elevC==null))elevC=elevC==null?e:elevC+(e-elevC)*.3;return elevC||0;};
  // Label sits just above the character's head: projected from the 3D model each frame, else from the map point.
  function placeLabel(){if(!agent){label.hidden=true;return;}let pt=topPx;
    if(!pt){const q=map.project([agent.lon,agent.lat]);pt=[q.x,q.y];}
    const c=map.getCanvas(),inView=pt[0]>-50&&pt[1]>-50&&pt[0]<c.clientWidth+50&&pt[1]<c.clientHeight+50;
    label.hidden=!inView;label.style.transform=`translate(${pt[0]}px,${pt[1]-6}px) translate(-50%,-100%)`;}
  const layer={id:'agent-3d',type:'custom',renderingMode:'3d',
    onAdd(m,gl){renderer=new THREE.WebGLRenderer({canvas:m.getCanvas(),context:gl,antialias:true});renderer.autoClear=false;
      scene=new THREE.Scene();camera=new THREE.Camera();
      scene.add(new THREE.HemisphereLight(0xffffff,0x445566,2.2));const d=new THREE.DirectionalLight(0xffffff,2);d.position.set(3,10,6);scene.add(d);
      // Blue rim light from behind so the character stands out from the dark night streets.
      const rim=new THREE.DirectionalLight('#5eb4ff',1.2);rim.position.set(-2,6,-8);scene.add(rim);
      ch=createCharacter(toLook(agent?.look,agent?.ownerName||agent?.name));model=ch.group;model.traverse(o=>{o.frustumCulled=false;});
      baseH=new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y||1;scene.add(model);
      applyLook();placeLabel();map.triggerRepaint();window.__avatarReady=true;},
    render(gl,args){if(!visible()){topPx=null;return;}
      if(!waved){waved=true;ch.play('wave');}
      ch.update(Math.min(clock.getDelta(),.1));
      const s=sizeM()/baseH,elev=elevation();
      M.fromArray(args.defaultProjectionData.mainMatrix).multiply(MM.fromArray(map.transform.getMatrixForModel([agent.lon,agent.lat],elev))).multiply(SM.makeScale(s,s,s));
      camera.projectionMatrix=M;
      // Face the camera.
      model.rotation.y=-map.getBearing()*Math.PI/180;
      const v=V.set(0,baseH*1.02,0,1).applyMatrix4(M);if(v.w>0){const c=map.getCanvas();topPx=[(v.x/v.w+1)/2*c.clientWidth,(1-v.y/v.w)/2*c.clientHeight];}renderer.resetState();renderer.render(scene,camera);
      // Animation at ~30 fps, only while the character is on screen and the app is in the foreground.
      if(!raf&&!document.hidden&&onScreen())raf=requestAnimationFrame(tick);}};
  function tick(t){if(t-lastT<33){raf=requestAnimationFrame(tick);return;}raf=0;lastT=t;map.triggerRepaint();}
  function applyLook(){if(!agent)return;ch?.setLook(toLook(agent.look,agent.ownerName||agent.name));label.textContent=agent.name;}
  const ensure=()=>{if(!map.getLayer('agent-3d'))map.addLayer(layer);};
  if(map.isStyleLoaded())ensure();map.on('style.load',ensure);map.on('load',ensure);
  map.on('render',()=>{if(!visible())topPx=null;placeLabel();});
  label.onclick=()=>map.flyTo({center:[agent.lon,agent.lat],zoom:19,pitch:65,essential:true});
  return {set(a){if(!a||!agent||a.lat!==agent.lat||a.lon!==agent.lon){elevC=null;waved=false;}agent=a;topPx=null;if(!a){label.hidden=true;map.triggerRepaint();return;}
    applyLook();placeLabel();try{ensure();}catch{}map.triggerRepaint();},
    play(n){ch?.play(n);map.triggerRepaint();}};}
