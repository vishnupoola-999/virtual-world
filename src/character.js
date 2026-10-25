// Virtual World agent characters: six creatures (design/creatures-v2-mockup.html, creatures-v2-notes.md), built procedurally.
// Same toon shader and shader-decal eyes and mouth as the mockup, with lower subdivision so every creature plus its accessory
// stays under 4k triangles on a ~Rs 10k Android phone. Geometry and materials are shared per creature type: the eye and mouth
// uniforms are set in update(), which every caller runs right before it renders that character.
// API: const c = createCharacter(look); scene.add(c.group); c.play('idle'|'walk'|'talk'|'wave'|'happy'); c.update(dt); c.setLook(look)
import * as THREE from 'three';
import {CREATURES,CREATURE_COLOURS,ACCESSORIES,sanitize,defaultLook,toLook} from './character-data.js';
export {CREATURES,CREATURE_COLOURS,ACCESSORIES,sanitize,defaultLook,toLook};
export const TRI_BUDGET=4000;
const SCALE=.78; // creatures are ~1.3 m tall in the mockup; the map, card and portrait cameras frame ~1 m
const KEY=new THREE.Vector3(-.45,.85,.6).normalize();
const TOON_VS=`varying vec3 vN;varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;vN=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*w;}`;
const TOON_FS=`uniform vec3 uC,uL;varying vec3 vN;varying vec3 vW;
void main(){vec3 n=normalize(vN);vec3 v=normalize(cameraPosition-vW);float d=dot(n,uL);
 vec3 sh=uC*vec3(.50,.56,.82);vec3 col=mix(sh,uC,smoothstep(-.12,.16,d));col=mix(col,uC*1.07+.035,smoothstep(.58,.74,d));
 col+=vec3(1.,.42,.28)*.10*exp(-pow(d/.22,2.));col+=uC*.10*max(-n.y,0.);
 float rim=pow(1.-max(dot(n,v),0.),3.2);col+=vec3(.72,.84,1.)*rim*.30*smoothstep(-.4,.4,n.y+.2);
 vec3 h=normalize(uL+v);col+=vec3(1.)*.16*smoothstep(.93,.975,dot(n,h));gl_FragColor=vec4(col,1.);
 #include <colorspace_fragment>
}`;
const toonCache=new Map();
function toon(hex){const k=String(hex);let m=toonCache.get(k);if(m)return m;
  m=new THREE.ShaderMaterial({uniforms:{uC:{value:new THREE.Color(hex)},uL:{value:KEY}},vertexShader:TOON_VS,fragmentShader:TOON_FS});toonCache.set(k,m);return m;}
const EYE_VS=`varying vec2 vU;void main(){vU=uv*2.-1.;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const EYE_FS=`uniform vec3 uT;uniform float uH,uB;uniform vec2 uLook;varying vec2 vU;
float circ(vec2 p,vec2 c,float r){float d=length(p-c)-r;float w=fwidth(d)*1.2;return 1.-smoothstep(-w,w,d);}
void main(){vec2 p=vU;vec3 ink=vec3(.006,.007,.012);float a;vec3 col;
 if(uH>.5){vec2 q=p-vec2(0.,-.42);float d=abs(length(q)-.58)-.13;if(q.y<0.)d=length(vec2(abs(q.x)-.58,q.y))-.13;float w=fwidth(d)*1.2;a=1.-smoothstep(-w,w,d);col=ink;}
 else{float sy=max(1.-uB,.06);vec2 e=vec2(p.x,p.y/sy);float r=length(e);float w=fwidth(r)*1.3;a=1.-smoothstep(1.-w,1.,r);
  vec2 ip=e-uLook*.12;float ir=length(ip-vec2(0.,-.06));
  vec3 iris=mix(ink,mix(ink,uT,.55),smoothstep(-.1,-.95,ip.y)*smoothstep(.95,.3,ir));
  col=mix(iris,ink*.4,circ(ip,vec2(0.,-.04),.38));col=mix(col,ink,smoothstep(.80,.97,r));
  float c1=circ(e,vec2(.30,.36),.25),c2=circ(e,vec2(-.30,-.38),.11);col=mix(col,vec3(1.),max(c1,c2*.9)*step(.25,sy));}
 gl_FragColor=vec4(col,a);
 #include <colorspace_fragment>
}`;
const MOUTH_FS=`uniform float uO;varying vec2 vU;
void main(){vec2 p=vU*vec2(1.,.5);vec3 ink=vec3(.006,.007,.012);float a;vec3 col=ink;
 if(uO<.04){vec2 c=vec2(0.,.42);vec2 q=p-c;float R=.72,am=.85;float ang=atan(q.x,-q.y);float d;
  if(abs(ang)<am)d=abs(length(q)-R);else{vec2 ep=c+R*vec2(sin(am)*sign(q.x),-cos(am));d=length(p-ep);}
  d-=.075;float w=fwidth(d)*1.2;a=1.-smoothstep(-w,w,d);}
 else{float ry=.12+.36*uO,rx=.52-.12*uO;vec2 q=(p-vec2(0.,.02-.12*uO))/vec2(rx,ry);float r=length(q);float w=fwidth(r)*1.3;a=1.-smoothstep(1.-w,1.,r);
  col=mix(vec3(.045,.009,.015),vec3(.85,.18,.2),smoothstep(.15,.85,-q.y)*smoothstep(1.,.6,r)*step(.3,uO));col=mix(col,ink,smoothstep(.78,1.,r));}
 gl_FragColor=vec4(col,a);
 #include <colorspace_fragment>
}`;
const decal=(u,fs)=>new THREE.ShaderMaterial({transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,uniforms:u,vertexShader:EYE_VS,fragmentShader:fs});
// ---- geometry (mockup SEG 56x36 -> 36x22: ~1.5k triangles for the body)
const SEG=[36,22];
function deformSphere(fn,seg=SEG){const g=new THREE.SphereGeometry(1,seg[0],seg[1]);const p=g.attributes.position,v=new THREE.Vector3();
  for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i);fn(v);p.setXYZ(i,v.x,v.y,v.z);}g.computeVertexNormals();return g;}
function smoothNormals(g){const p=g.attributes.position,n=g.attributes.normal,map=new Map();
  for(let i=0;i<p.count;i++){const k=p.getX(i).toFixed(4)+','+p.getY(i).toFixed(4)+','+p.getZ(i).toFixed(4);(map.get(k)||map.set(k,[]).get(k)).push(i);}
  const s=new THREE.Vector3(),t=new THREE.Vector3();
  for(const ids of map.values()){if(ids.length<2)continue;s.set(0,0,0);ids.forEach(i=>s.add(t.fromBufferAttribute(n,i)));s.normalize();ids.forEach(i=>n.setXYZ(i,s.x,s.y,s.z));}return g;}
const body=(fn,seg)=>smoothNormals(deformSphere(fn,seg));
const geoCache=new Map();const G=(k,f)=>{let g=geoCache.get(k);if(!g){g=f();g.userData.shared=true;geoCache.set(k,g);}return g;};
const nubGeo=()=>G('nub',()=>smoothNormals(new THREE.SphereGeometry(.1,10,6)));
const nub=(m,x,z,s=1)=>{const n=new THREE.Mesh(nubGeo(),m);n.scale.set(1.15*s,.55*s,1.3*s);n.position.set(x,.045*s,z);return n;};
// eyeR = eye diameter / head width; gap = inner eye gap / eye diameter; mouthR = mouth width / head width; mouthDrop in eye diameters
const FACE={eyeR:.215,gap:.62,mouthR:.19,mouthDrop:.95};
const DEFS={
  blob:{iris:0x3C5BD6,geo:()=>body(v=>{const y=v.y;const wf=1-.20*Math.pow(Math.max(y,0),2.2)+.05*Math.max(-y,0);v.x*=.62*wf;v.z*=.56*wf;v.y=(y>0?y*.70:y*.34)+.36;}),eyeY:.50,
    extra:(b,m)=>{b.add(nub(m,-.24,.16),nub(m,.24,.16));}},
  puff:{iris:0x6A48D8,geo:()=>body(v=>{const n=.011*(Math.sin(v.x*13+1)*Math.sin(v.y*11)*Math.sin(v.z*12+2));v.multiplyScalar(.56*(1+n));v.y+=.57;},[38,24]),eyeY:.55,
    extra:(b,m)=>{const eg=G('ear',()=>smoothNormals(new THREE.SphereGeometry(.15,12,8)));[-1,1].forEach(s=>{const e=new THREE.Mesh(eg,m);e.scale.set(.75,1.25,.55);e.position.set(s*.33,1.02,-.02);e.rotation.z=-s*.42;b.add(e);});b.add(nub(m,-.2,.17,.9),nub(m,.2,.17,.9));}},
  sprout:{iris:0x1E8E5E,geo:()=>body(v=>{const y=v.y;v.x*=.43*(1+.07*Math.max(-y,0));v.z*=.41;v.y=y*.56+.58;}),eyeY:.56,
    extra:(b,m)=>{const sm=toon(0x34B57E),lm=toon(0x9BF2C8);const st=new THREE.Mesh(G('stem',()=>new THREE.CylinderGeometry(.024,.034,.14,8)),sm);st.position.y=1.19;b.add(st);
      const lg=G('leaf',()=>body(v=>{v.x*=.15;v.y*=.035;v.z*=.085;v.y+=.02*Math.pow(v.x/.15,2)*4;},[16,8]));
      [-1,1].forEach(s=>{const l=new THREE.Mesh(lg,lm);l.position.set(s*.13,1.27,0);l.rotation.z=s*.38;b.add(l);});b.add(nub(m,-.17,.13,.85),nub(m,.17,.13,.85));}},
  // Diggy review: face lowered a little (eyeY .40 -> .36).
  pebble:{iris:0xC2452A,geo:()=>body(v=>{const y=v.y;v.x*=.62;v.z*=.50;v.y=(y>0?y*.42:y*.30)+.31;v.x+=.03*v.y;}),eyeY:.36,mouthDrop:.82,
    extra:(b,m)=>{const ag=G('armP',()=>{const g=new THREE.CapsuleGeometry(.06,.1,3,8);g.translate(0,-.08,0);return g;});b.userData.arms=[-1,1].map(s=>{const a=new THREE.Mesh(ag,m);a.position.set(s*.58,.36,.06);a.rotation.z=s*.55;b.add(a);return a;});}},
  drip:{iris:0xB0761A,geo:()=>body(v=>{const y=v.y;const t=Math.max(y,0);v.x*=.52*(1-.62*Math.pow(t,1.25));v.z*=.48*(1-.62*Math.pow(t,1.25));v.y=(y>0?y*.78:y*.42)+.42;v.x+=.11*Math.pow(t,2.2);}),eyeY:.44,
    extra:(b,m)=>{b.add(nub(m,-.19,.15,.9),nub(m,.19,.15,.9));}},
  mallow:{iris:0x1E7F8C,geo:()=>body(v=>{const y=v.y,r=Math.hypot(v.x,v.z)||1e-6;const ny=Math.sign(y)*Math.pow(Math.abs(y),.42),nr=Math.pow(Math.sqrt(Math.max(0,1-y*y)),.42);v.x=v.x/r*nr*.46;v.z=v.z/r*nr*.42;v.y=ny*.52+.53;}),eyeY:.66,
    extra:(b,m)=>{const ag=G('armM',()=>{const g=new THREE.CapsuleGeometry(.055,.08,3,8);g.translate(0,-.06,0);return g;});b.userData.arms=[-1,1].map(s=>{const a=new THREE.Mesh(ag,m);a.position.set(s*.47,.5,.04);a.rotation.z=s*.45;b.add(a);return a;});b.add(nub(m,-.18,.14,.85),nub(m,.18,.14,.85));}},
};
// Per creature type: body geometry, face placement (raycast once) and the shared eye/mouth materials.
const RC=new THREE.Raycaster();const typeCache=new Map();
function typeData(name){let t=typeCache.get(name);if(t)return t;const def={...FACE,...DEFS[name]};const geo=G('body-'+name,def.geo);
  const probe=new THREE.Mesh(geo);probe.updateMatrixWorld(true);
  const hit=(o,d)=>{RC.set(o,d.normalize());return RC.intersectObject(probe,false)[0];};
  const top=hit(new THREE.Vector3(0,5,0),new THREE.Vector3(0,-1,0)).point.y;
  const sideAt=y=>hit(new THREE.Vector3(5,y,0),new THREE.Vector3(-1,0,0))?.point.x??.3;
  const hw=sideAt(def.eyeY)*2,ed=hw*def.eyeR,ex=(ed*def.gap+ed)/2,mw=hw*def.mouthR;
  const place=(x,y)=>{const h=hit(new THREE.Vector3(x,y,5),new THREE.Vector3(0,0,-1));const p=h.point.clone().addScaledVector(h.face.normal,.004);return {p,look:h.point.clone().add(h.face.normal)};};
  const eyeU={uT:{value:new THREE.Color(def.iris)},uH:{value:0},uB:{value:0},uLook:{value:new THREE.Vector2()}};
  t={def,geo,top,sideAt,hw,ed,mw,eyes:[-1,1].map(s=>place(s*ex,def.eyeY)),mouth:place(0,def.eyeY-ed*def.mouthDrop),
    mat:toon(CREATURE_COLOURS[name]),eyeMat:decal(eyeU,EYE_FS),mouthMat:decal({uO:{value:0}},MOUTH_FS)};typeCache.set(name,t);return t;}
// ---- accessories (segments cut from the mockup: glasses 40->20, beanie 36x14->18x7, ...). Diggy review: the beanie gets a real cuff.
const ACC_INK=0x2B2F3D;
function addAcc(b,kind,T){const g=new THREE.Group();b.add(g);const top=T.top,ed=T.ed;
  if(kind==='glasses'){const mat=toon(ACC_INK);const ring=G('gl-ring'+ed.toFixed(3),()=>new THREE.TorusGeometry(ed*.66,.016,5,20));
    const lens=G('gl-lens'+ed.toFixed(3),()=>new THREE.CircleGeometry(ed*.65,16)),lm=G('m-lens',()=>new THREE.MeshBasicMaterial({color:0xBFD8FF,transparent:true,opacity:.10,depthWrite:false}));
    for(const e of T.eyes){for(const [geo,m] of [[ring,mat],[lens,lm]]){const o=new THREE.Mesh(geo,m);o.position.copy(e.p);o.lookAt(e.look);o.translateZ(.05);g.add(o);}}
    const p0=T.eyes[0].p,p1=T.eyes[1].p;const br=new THREE.Mesh(new THREE.TorusGeometry(Math.max(.01,(p1.x-p0.x)/2-ed*.66),.014,5,10,Math.PI),mat);br.position.set(0,p0.y+.02,Math.max(p0.z,p1.z)+.07);g.add(br);}
  if(kind==='beanie'){const mat=toon(0xFFD166),cuffM=toon(0xF2B83F);const r=T.sideAt(top-.06)*1.12;
    const cap=new THREE.Mesh(smoothNormals(new THREE.SphereGeometry(r,18,7,0,Math.PI*2,0,Math.PI/2)),mat);cap.scale.y=.8;cap.position.y=top-.06;g.add(cap);
    const band=new THREE.Mesh(new THREE.CylinderGeometry(r*1.04,r*1.07,.11,18,1,true),cuffM);band.position.y=top-.095;g.add(band);
    [[-.15,1.07],[-.04,1.04]].forEach(([dy,k])=>{const t=new THREE.Mesh(new THREE.TorusGeometry(r*k,.024,5,18),cuffM);t.rotation.x=Math.PI/2;t.position.y=top+dy;g.add(t);});
    const pom=new THREE.Mesh(smoothNormals(new THREE.SphereGeometry(.075,10,7)),toon(0xFFF3D6));pom.position.y=top-.06+r*.8+.03;g.add(pom);g.rotation.z=-.12;}
  if(kind==='tuft'){[[0,1],[.05,.75],[-.05,.7]].forEach(([x,s],i)=>{const cu=new THREE.CatmullRomCurve3([new THREE.Vector3(x,top-.03,0),new THREE.Vector3(x+.02*s,top+.1*s,.02),new THREE.Vector3(x+.1*s*(i==2?-1:1),top+.16*s,.07)]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(cu,8,.035*s,6),T.mat));const c=new THREE.Mesh(new THREE.SphereGeometry(.035*s,8,6),T.mat);c.position.copy(cu.getPoint(1));g.add(c);});}
  if(kind==='headphones'){const mat=toon(0x3A3F52),pad=toon(0xFF7A59);const y=T.def.eyeY+.08,sx=T.sideAt(y);
    const band=new THREE.Mesh(new THREE.TorusGeometry(1,.028,5,20,Math.PI),mat);band.scale.set(sx+.06,Math.max(.1,top-y+.05),1);band.position.y=y;g.add(band);
    [-1,1].forEach(s=>{const cup=new THREE.Mesh(G('hp-cup',()=>new THREE.CylinderGeometry(.13,.13,.08,16)),pad);cup.rotation.z=Math.PI/2;cup.position.set(s*(sx+.03),y,0);g.add(cup);
      const rim=new THREE.Mesh(G('hp-rim',()=>new THREE.TorusGeometry(.13,.02,4,16)),mat);rim.rotation.y=Math.PI/2;rim.position.set(s*(sx+.07),y,0);g.add(rim);});}
  if(kind==='bow'){const mat=toon(0xFF7A59);const grp=new THREE.Group();grp.position.set(T.sideAt(top-.12)*.55,top-.06,.05);grp.rotation.z=-.35;
    const lg=G('bow-l',()=>smoothNormals(new THREE.SphereGeometry(.09,12,8)));
    [-1,1].forEach(s=>{const l=new THREE.Mesh(lg,mat);l.scale.set(1.25,.85,.5);l.position.x=s*.1;l.rotation.z=s*.25;grp.add(l);});
    const k=new THREE.Mesh(G('bow-k',()=>smoothNormals(new THREE.SphereGeometry(.045,10,6))),mat);k.scale.z=.7;grp.add(k);g.add(grp);}
  return g;}
// Frees per-instance geometry only; shared per-creature geometry and materials stay cached.
export function disposeGroup(o){o.traverse(m=>{if(m.isMesh&&!m.geometry.userData.shared)m.geometry.dispose();});}
const ease=x=>x*x*(3-2*x);
let seq=0;
export function createCharacter(look=defaultLook()){
  const group=new THREE.Group();group.name='agent-character';
  let cur=null,T=null,bodyG=null,mouth=null,state='idle',t=0;const phase=(seq++*1.37)%7,seed=(seq*.71)%5;
  function build(){disposeGroup(group);group.clear();T=typeData(cur.creature);
    const root=new THREE.Group();root.scale.setScalar(SCALE);group.add(root);bodyG=new THREE.Group();root.add(bodyG);
    bodyG.add(new THREE.Mesh(T.geo,T.mat));T.def.extra(bodyG,T.mat);
    T.eyes.forEach(e=>{const m=new THREE.Mesh(G('eye-'+cur.creature,()=>new THREE.PlaneGeometry(T.ed,T.ed*1.12)),T.eyeMat);m.position.copy(e.p);m.lookAt(e.look);m.renderOrder=2;bodyG.add(m);});
    mouth=new THREE.Mesh(G('mouth-'+cur.creature,()=>new THREE.PlaneGeometry(T.mw,T.mw*.5)),T.mouthMat);mouth.position.copy(T.mouth.p);mouth.lookAt(T.mouth.look);mouth.renderOrder=2;bodyG.add(mouth);
    if(cur.accessory!=='none')addAcc(bodyG,cur.accessory,T);}
  function setLook(l){const prev=cur;cur=toLook(l);if(!prev||prev.creature!==cur.creature||prev.accessory!==cur.accessory)build();}
  function play(name){state=name==='wave'?'happy':name;t=0;}
  // One happy hop: anticipation squash, airborne stretch, landing squash. p in 0..1.
  function hop(p,H){if(p<.16){return [0,1-.20*Math.sin(p/.16*Math.PI)];}if(p<.74){const q=(p-.16)/.58;return [H*4*q*(1-q),1+.13*Math.sin(q*Math.PI)*(1-q*.6)];}return [0,1-.22*Math.sin((p-.74)/.26*Math.PI)];}
  let blinkT=1.5+seed;
  function update(dt){t+=dt||0;if(!bodyG)return;const T0=performance.now()/1000+phase;
    let sy=1+.03*Math.sin(T0*2.1),y=0,happy=false,o=0;const sway=.045*Math.sin(T0*1.05);
    if(state==='happy'){const P=1.15;if(t<P*2){[y,sy]=hop((t%P)/P,.22);happy=true;o=.55;}else state='idle';}
    else if(state==='walk'){const p=(T0%.5)/.5;const w=hop(p,.07);y=w[0];sy=1+(w[1]-1)*.6;}
    else if(state==='talk'){if(t<1.15){[y,sy]=hop(t/1.15,.2);happy=true;o=.55;} // happy hop when the meet starts, then talk
      else{o=Math.min(1,Math.max(.06,.55+.5*Math.sin(T0*10.5)*Math.sin(T0*3.1+1)+.2*Math.sin(T0*16.7)));}}
    const sx=1/Math.sqrt(sy);bodyG.position.y=y;bodyG.scale.set(sx,sy,sx);bodyG.rotation.z=sway;bodyG.rotation.y=.10*Math.sin(T0*.6);
    blinkT-=dt||0;let bl=0;if(blinkT<0){bl=Math.sin(Math.min(1,-blinkT/.16)*Math.PI);if(blinkT<-.16)blinkT=3+2*((Math.sin(T0*12.9)+1)/2);}
    const u=T.eyeMat.uniforms;u.uB.value=happy?0:bl;u.uH.value=happy?1:0;u.uLook.value.set(.25*Math.sin(T0*.37),.1*Math.sin(T0*.23));
    T.mouthMat.uniforms.uO.value=o;
    if(bodyG.userData.arms)bodyG.userData.arms.forEach((a,i)=>{const s=i?1:-1;a.rotation.z=s*(.55+(happy?.7*ease(.5+.5*Math.sin(T0*6)):.1*Math.sin(T0*2)));});}
  function triangles(){let n=0;group.traverse(o=>{if(o.isMesh){const g=o.geometry;n+=(g.index?g.index.count:g.attributes.position.count)/3;}});return Math.round(n);}
  setLook(look);
  return {group,setLook,play,update,triangles,dispose(){disposeGroup(group);group.clear();},get look(){return {...cur};}};
}
