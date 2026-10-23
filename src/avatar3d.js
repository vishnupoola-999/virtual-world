// The user's agent as an animated 3D character standing on the map (MapLibre custom layer rendered by three.js).
// Model: RobotExpressive by Tomás Laulhé (CC0), from the three.js examples, vendored in assets/robot.glb.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const MIN_PX=56;      // character is never drawn smaller than this on screen…
const REAL_H=2.2;     // …and never smaller than ~2.2 m in the world
let gltfP=null;const loadGltf=()=>gltfP||=new GLTFLoader().loadAsync(new URL('../assets/robot.glb',import.meta.url).href);
export function avatarLayer(map){
  let agent=null,renderer,scene,camera,model,mixer,baseH=1,tint=[],last=0;const clock=new THREE.Clock();
  const label=document.createElement('div');label.className='agLabel';label.hidden=true;map.getContainer().appendChild(label);
  let topPx=null;
  const mpp=()=>40075016.686*Math.cos(agent.lat*Math.PI/180)/(512*2**map.getZoom());
  const sizeM=()=>Math.max(REAL_H,MIN_PX*mpp());
  const visible=()=>agent&&model&&map.getZoom()>=11&&map.getBounds().contains([agent.lon,agent.lat]);
  // Label sits just above the character's head: projected from the 3D model each frame, else from the map point.
  function placeLabel(){if(!agent){label.hidden=true;return;}let pt=topPx;
    if(!pt){const q=map.project([agent.lon,agent.lat]);pt=[q.x,q.y];}
    const c=map.getCanvas(),inView=pt[0]>-50&&pt[1]>-50&&pt[0]<c.clientWidth+50&&pt[1]<c.clientHeight+50;
    label.hidden=!inView;label.style.transform=`translate(${pt[0]}px,${pt[1]-6}px) translate(-50%,-100%)`;}
  const layer={id:'agent-3d',type:'custom',renderingMode:'3d',
    onAdd(m,gl){renderer=new THREE.WebGLRenderer({canvas:m.getCanvas(),context:gl,antialias:true});renderer.autoClear=false;
      scene=new THREE.Scene();camera=new THREE.Camera();
      scene.add(new THREE.HemisphereLight(0xffffff,0x445566,2.2));const d=new THREE.DirectionalLight(0xffffff,2);d.position.set(3,10,6);scene.add(d);
      loadGltf().then(g=>{model=g.scene;const box=new THREE.Box3().setFromObject(model);baseH=box.max.y-box.min.y||1;
        model.traverse(o=>{if(o.isMesh){o.frustumCulled=false;const ms=Array.isArray(o.material)?o.material:[o.material];
          ms.forEach((mt,i)=>{if(/main/i.test(mt.name)){const c=mt.clone();if(Array.isArray(o.material))o.material[i]=c;else o.material=c;tint.push(c);}});}});
        mixer=new THREE.AnimationMixer(model);const clip=g.animations.find(a=>a.name==='Idle')||g.animations[0];if(clip)mixer.clipAction(clip).play();
        scene.add(model);applyLook();placeLabel();map.triggerRepaint();window.__avatarReady=true;})
      .catch(e=>{console.warn('avatar model failed',e);window.__avatarReady=false;});},
    render(gl,args){if(!visible()){topPx=null;return;}
      const now=performance.now();mixer?.update(Math.min(clock.getDelta(),.1));
      const s=sizeM()/baseH,elev=map.queryTerrainElevation?.([agent.lon,agent.lat])||0;
      const M=new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix)
        .multiply(new THREE.Matrix4().fromArray(map.transform.getMatrixForModel([agent.lon,agent.lat],elev)))
        .multiply(new THREE.Matrix4().makeScale(s,s,s));
      camera.projectionMatrix=M;
      const v=new THREE.Vector4(0,baseH*1.02,0,1).applyMatrix4(M);if(v.w>0){const c=map.getCanvas();topPx=[(v.x/v.w+1)/2*c.clientWidth,(1-v.y/v.w)/2*c.clientHeight];}renderer.resetState();renderer.render(scene,camera);
      // ~30 fps idle animation, only while the character is on screen (saves phone battery)
      if(now-last>30){last=now;setTimeout(()=>map.triggerRepaint(),33);}}};
  function applyLook(){if(!agent)return;const c=new THREE.Color(agent.look?.color||'#7e57c2');for(const m of tint)m.color.copy(c);
    label.textContent=`${agent.look?.emoji||'🤖'} ${agent.name}`;}
  const ensure=()=>{if(!map.getLayer('agent-3d'))map.addLayer(layer);};
  if(map.isStyleLoaded())ensure();map.on('style.load',ensure);map.on('load',ensure);
  map.on('render',()=>{if(!visible())topPx=null;placeLabel();});
  label.onclick=()=>map.flyTo({center:[agent.lon,agent.lat],zoom:19,pitch:65,essential:true});
  return {set(a){agent=a;topPx=null;if(!a){label.hidden=true;map.triggerRepaint();return;}
    applyLook();placeLabel();try{ensure();}catch{}map.triggerRepaint();}};}
