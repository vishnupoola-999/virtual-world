// Virtual World agent characters: two stylised base bodies (girl, boy), built procedurally in three.js.
// No external assets: ~3-5k triangles, flat vertex-free materials so every part is recolourable at runtime.
// API: const c = createCharacter(look); scene.add(c.group); c.play('idle'|'wave'|'walk'|'talk'); c.update(dt); c.setLook(look)
import * as THREE from 'three';

export const SKIN = ['#f6d7c3','#eec1a0','#d9a07a','#c08560','#9a6544','#6e4630'];
export const HAIR_COLOURS = ['#1b1512','#3b2618','#6b4226','#a8743f','#c9c2b8','#6d3fc0'];
export const OUTFIT_COLOURS = ['#1e88e5','#ff7043','#3ddc97','#ffc861','#e25d9b','#7e57c2','#eef2ff','#26324f'];
export const HAIRSTYLES = { boy:['short','spiky','curly','buzz'], girl:['long','ponytail','bun','bob','curly','short'] };
export const OUTFITS = { boy:['tee','hoodie','kurta'], girl:['tee','hoodie','kurta','dress'] }; // boy kurta = straight men's cut with collar
export const ACCESSORIES = { boy:['none','glasses','headphones','cap'], girl:['none','glasses','headphones','cap','bindi'] };
// Keep a look valid for its base (used when switching Girl/Boy)
export function sanitize(l){const b=l.base,d=defaultLook(b);return {...l,hair:HAIRSTYLES[b].includes(l.hair)?l.hair:d.hair,outfit:OUTFITS[b].includes(l.outfit)?l.outfit:d.outfit,acc:(l.acc||[]).filter(a=>ACCESSORIES[b].includes(a))};}

export function defaultLook(base='girl'){
  return base==='boy'
    ? {v:1,base:'boy', skin:SKIN[2],hair:'short',hairColour:HAIR_COLOURS[0],outfit:'tee',  outfitColour:OUTFIT_COLOURS[0],bottomColour:'#26324f',acc:[]}
    : {v:1,base:'girl',skin:SKIN[2],hair:'long', hairColour:HAIR_COLOURS[0],outfit:'dress',outfitColour:OUTFIT_COLOURS[1],bottomColour:'#26324f',acc:[]};
}

const mat=(c,r=.92)=>new THREE.MeshStandardMaterial({color:c,roughness:r,metalness:0});
function roundBox(w,h,d,r){const g=new THREE.BoxGeometry(w,h,d,6,4,6),p=g.attributes.position,v=new THREE.Vector3(),c=new THREE.Vector3(),hw=w/2-r,hh=h/2-r,hd=d/2-r;
  for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i);c.set(Math.max(-hw,Math.min(hw,v.x)),Math.max(-hh,Math.min(hh,v.y)),Math.max(-hd,Math.min(hd,v.z)));v.sub(c).normalize().multiplyScalar(r).add(c);p.setXYZ(i,v.x,v.y,v.z);}g.computeVertexNormals();return g;}
const S=(r,w=18,h=14)=>new THREE.SphereGeometry(r,w,h);
const cap=(r,l,s=10)=>new THREE.CapsuleGeometry(r,l,4,s);
function mesh(g,m,x=0,y=0,z=0,p){const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.castShadow=true;(p||null)?.add(o);return o;}

export function createCharacter(look=defaultLook()){
  const group=new THREE.Group();group.name='agent-character';
  const M={skin:mat(SKIN[2],.85),hair:mat('#1b1512',.8),top:mat('#1e88e5'),bottom:mat('#26324f'),shoe:mat('#eef2ff',.5),
    eye:mat('#141821',.5),white:new THREE.MeshBasicMaterial({color:'#ffffff'}),mouth:mat('#2a1c1c',.9),acc:mat('#141821',.4),accent:mat('#5eb4ff',.4),bindi:mat('#d7263d',.4)};
  let rig={},state='idle',t=0,blinkT=2,cur=null;

  function build(){
    group.clear();const L=cur,girl=L.base==='girl';
    const root=new THREE.Group();group.add(root);
    const hips=new THREE.Group();hips.position.y=.42;root.add(hips);
    // legs (pivot at hip) + shoes
    const legs=[-1,1].map(sx=>{const p=new THREE.Group();p.position.set(sx*.075,0,0);hips.add(p);
      mesh(cap(.052,.26),M.bottom,0,-.2,0,p);const sh=mesh(S(.065,12,8),M.shoe,0,-.385,.03,p);sh.scale.set(1,.6,1.45);return p;});
    // torso
    const torso=new THREE.Group();hips.add(torso);
    const tw=girl?.12:.15;
    const body=mesh(cap(tw,.16,14),M.top,0,.17,0,torso);body.scale.set(girl?1:1.12,1,.78);
    if(!girl){const sh=mesh(cap(.07,tw*1.5,10),M.top,0,.28,0,torso);sh.rotation.z=Math.PI/2;sh.scale.set(1,1,.9);} // squarer shoulders
    if(girl&&(L.outfit==='dress'||L.outfit==='kurta')){const len=L.outfit==='dress'?.26:.2;
      mesh(new THREE.CylinderGeometry(tw*.95,tw*1.45,len,16,1,true),M.top,0,.08-len/2+.04,0,torso).material.side=THREE.DoubleSide;}
    if(!girl&&L.outfit==='kurta'){const k=mesh(new THREE.CylinderGeometry(tw*1.08,tw*1.12,.2,16,1,true),M.top,0,.02,0,torso);k.material.side=THREE.DoubleSide;k.scale.set(1.08,1,.82);
      const col=mesh(new THREE.CylinderGeometry(.045,.05,.035,14,1,true),M.top,0,.355,0,torso);col.material.side=THREE.DoubleSide;}
    if(L.outfit==='hoodie'){const h=mesh(new THREE.TorusGeometry(.085,.035,8,16),M.top,0,.33,-.03,torso);h.rotation.x=Math.PI/2.4;
      mesh(S(.012,6,4),M.white,-.03,.25,.105,torso);mesh(S(.012,6,4),M.white,.03,.25,.105,torso);}
    if(L.outfit==='kurta'){[.28,.24,.2].forEach(y=>mesh(S(.009,6,4),M.white,0,y,.102,torso));}
    if(L.outfit==='tee'){const c=mesh(new THREE.TorusGeometry(.05,.012,6,16),M.white,0,.335,.01,torso);c.rotation.x=Math.PI/2;}
    // arms (pivot at shoulder)
    const arms=[-1,1].map(sx=>{const p=new THREE.Group();p.position.set(sx*(tw+.03),.3,0);torso.add(p);
      const sleeveLong=L.outfit!=='tee'&&L.outfit!=='dress';
      mesh(cap(.04,.17),sleeveLong?M.top:M.skin,0,-.12,0,p);
      if(!sleeveLong)mesh(cap(.046,.04),M.top,0,-.04,0,p);
      mesh(S(.045,10,8),M.skin,0,-.24,0,p);p.rotation.z=sx*.12;return p;});
    // neck + head
    mesh(new THREE.CylinderGeometry(.035,.04,.06,10),M.skin,0,.36,0,torso);
    const head=new THREE.Group();head.position.y=.55;head.scale.setScalar(1.18);torso.add(head);
    const skull=mesh(S(.17,24,18),M.skin,0,0,0,head);skull.scale.set(girl?1:1.04,girl?1.02:.98,.95);
    if(!girl){const p=skull.geometry.attributes.position;for(let i=0;i<p.count;i++){const y=p.getY(i);if(y<0){const k=1+.16*Math.min(1,-y/.12);p.setX(i,p.getX(i)*k);p.setY(i,Math.max(y,-.15+(-.15-y)*-.0));}}skull.geometry.computeVertexNormals();} // broader, squarer jaw (deformed skull, no seams) // broader, squarer jaw
    [-1,1].forEach(sx=>{const e=mesh(S(.035,10,8),M.skin,sx*.168,-.01,0,head);e.scale.set(.5,1,.8);});
    const eyes=[-1,1].map(sx=>{const e=mesh(S(.032,12,10),M.eye,sx*.064,-.005,.15,head);e.scale.set(.85,1.15,.5);
      mesh(S(.008,6,4),M.white,.008,.012,.012,e);if(girl){const l=mesh(new THREE.BoxGeometry(.012,.005,.005),M.eye,sx*.026,.02,0,e);l.rotation.z=sx*-.6;}return e;}); // girl: one tiny lash flick, boy: none
    [-1,1].forEach(sx=>{const b=mesh(cap(girl?.006:.011,girl?.03:.04,4),M.hair,sx*.064,girl?.058:.055,.153,head);b.rotation.z=Math.PI/2+sx*(girl?-.2:-.05);});
    mesh(S(.016,8,6),M.skin,0,-.025,.165,head);
    const smile=mesh(new THREE.TorusGeometry(.018,.0045,6,12,Math.PI*.8),M.mouth,0,-.058,.158,head);smile.rotation.z=Math.PI*1.1;
    const mouth=mesh(S(.021,12,8),M.mouth,0,-.066,.154,head);mouth.scale.set(1,.15,.5);mouth.visible=false;
    buildHair(head,L);buildAcc(head,L);
    rig={root,hips,legs,torso,arms,head,eyes,mouth,smile};
  }
  function buildHair(head,L){const H=M.hair,s=L.hair;
    const top=mesh(new THREE.SphereGeometry(.182,24,14,0,Math.PI*2,0,Math.PI*.47),H,0,.014,-.012,head);top.rotation.x=-.5;
    if(s==='buzz'){top.scale.set(.97,.98,.97);return;}
    const fr=mesh(S(.09,14,8),H,.035,.135,.1,head);fr.scale.set(1.45,.42,.6);fr.rotation.set(-.5,0,-.3);
    if(s==='short'){const b=mesh(S(.17,16,10),H,0,.03,-.06,head);b.scale.set(1.04,.9,.88);}
    if(s==='spiky'){for(let i=0;i<7;i++){const a=i/7*Math.PI*2;const c=mesh(new THREE.ConeGeometry(.045,.11,6),H,Math.cos(a)*.08,.17,Math.sin(a)*.07-.02,head);c.rotation.set(Math.sin(a)*.6,0,-Math.cos(a)*.6);} mesh(new THREE.ConeGeometry(.045,.12,6),H,0,.21,0,head);}
    if(s==='curly'){for(let i=0;i<16;i++){const a=i/16*Math.PI*2,y=.06+(i%3)*.045;mesh(S(.055,8,6),H,Math.cos(a)*.15,y,Math.sin(a)*.13-.02,head);} mesh(S(.08,10,8),H,0,.17,0,head);}
    if(s==='long'){const b=mesh(cap(.15,.18,14),H,0,-.1,-.08,head);b.scale.set(1.12,1,.6);
      [-1,1].forEach(sx=>{const l=mesh(cap(.04,.2,8),H,sx*.15,-.12,.04,head);l.rotation.z=sx*.08;});}
    if(s==='bob'){const b=mesh(S(.19,18,12),H,0,0,-.06,head);b.scale.set(1.06,.95,.85);[-1,1].forEach(sx=>{const l=mesh(S(.07,10,8),H,sx*.15,-.06,.03,head);l.scale.set(.6,1.1,.8);});}
    if(s==='ponytail'){mesh(S(.035,8,6),H,0,.06,-.18,head);const p=mesh(cap(.05,.2,8),H,0,-.08,-.22,head);p.rotation.x=.25;}
    if(s==='bun'){mesh(S(.075,12,10),H,0,.17,-.1,head);}
  }
  function buildAcc(head,L){const A=L.acc||[];
    if(A.includes('glasses')){[-1,1].forEach(sx=>mesh(new THREE.TorusGeometry(.038,.006,6,16),M.acc,sx*.062,0,.17,head));
      mesh(new THREE.BoxGeometry(.04,.006,.006),M.acc,0,.005,.172,head);}
    if(A.includes('headphones')){const b=mesh(new THREE.TorusGeometry(.19,.014,6,20,Math.PI),M.acc,0,.0,0,head);
      [-1,1].forEach(sx=>{const c=mesh(new THREE.CylinderGeometry(.045,.045,.035,14),M.accent,sx*.185,-.01,0,head);c.rotation.z=Math.PI/2;});}
    if(A.includes('cap')){const c=mesh(new THREE.SphereGeometry(.19,20,10,0,Math.PI*2,0,Math.PI*.42),M.accent,0,.02,0,head);
      const v=mesh(new THREE.CylinderGeometry(.13,.13,.012,16,1,false,-Math.PI/2,Math.PI),M.accent,0,.08,.1,head);v.rotation.x=.12;}
    if(A.includes('bindi'))mesh(S(.009,8,6),M.bindi,0,.035,.172,head);
  }
  function setLook(l){const prev=cur;cur=sanitize({...defaultLook(l?.base),...l});
    M.skin.color.set(cur.skin);M.hair.color.set(cur.hairColour);M.top.color.set(cur.outfitColour);M.bottom.color.set(cur.bottomColour);
    M.shoe.color.set(cur.outfitColour==='#eef2ff'?'#26324f':'#eef2ff');
    const shape=k=>JSON.stringify([k.base,k.hair,k.outfit,k.acc]);
    if(!prev||shape(prev)!==shape(cur))build();}  // colour-only changes are instant (no rebuild)
  function play(name){state=name;t=0;}
  function update(dt){t+=dt;const r=rig,T=performance.now()/1000;if(!r.root)return;
    const breathe=Math.sin(T*2)*.008;r.torso.position.y=breathe;r.torso.rotation.set(0,0,0);r.head.rotation.set(0,0,0);r.root.position.y=0;
    r.arms[0].rotation.set(0,0,-.12);r.arms[1].rotation.set(0,0,.12);r.legs.forEach(l=>l.rotation.set(0,0,0));
    r.head.rotation.z=Math.sin(T*.9)*.04;r.head.rotation.y=Math.sin(T*.5)*.08;let open=0;
    if(state==='wave'){const k=Math.min(1,t*4);r.arms[1].rotation.z=.12+k*2.6;r.arms[1].rotation.x=0;r.arms[1].rotation.y=0;
      r.arms[1].rotation.z+=Math.sin(T*10)*.25*k;r.head.rotation.z=.1*k;if(t>2.2)play('idle');}
    if(state==='walk'){const w=Math.sin(T*8);r.legs[0].rotation.x=w*.5;r.legs[1].rotation.x=-w*.5;r.arms[0].rotation.x=-w*.45;r.arms[1].rotation.x=w*.45;
      r.root.position.y=Math.abs(Math.cos(T*8))*.02;r.torso.rotation.y=w*.06;}
    if(state==='talk'){// eased, varied syllables: smooth bumps with changing peak height
      const syl=T*7,ph=syl%1,amp=.45+.55*Math.abs(Math.sin(Math.floor(syl)*12.9898));open=amp*Math.sin(Math.PI*ph)**2;r.head.rotation.x=Math.sin(T*3)*.06;
      r.arms[1].rotation.x=-.5-Math.sin(T*2.5)*.25;r.arms[1].rotation.z=.25;}
    r.mouthOpen=(r.mouthOpen||0)+(open-(r.mouthOpen||0))*Math.min(1,dt*18);const o=r.mouthOpen;
    r.mouth.visible=o>.04;r.smile.visible=!r.mouth.visible;r.mouth.scale.set(.85+o*.2,.2+o*.9,.5);
    blinkT-=dt;const bl=blinkT<0?Math.max(.1,Math.abs(blinkT*12+1)):1;if(blinkT<-.16)blinkT=2+Math.random()*3;r.eyes.forEach(e=>e.scale.y=1.15*Math.min(1,bl));}
  function triangles(){let n=0;group.traverse(o=>{if(o.isMesh){const g=o.geometry;n+=(g.index?g.index.count:g.attributes.position.count)/3;}});return n;}
  setLook(look);
  return {group,setLook,play,update,triangles,get look(){return {...cur};}};
}

// Name -> default base. Only a starting guess: the user can switch instantly.
const GIRL=new Set('srilatha lakshmi priya divya swathi kavya sneha anjali pooja keerthi sravani sindhu harika bhavana deepika lavanya meghana mounika navya pallavi ramya sahithi sai_priya shreya sowmya spandana tejaswini vaishnavi varsha akhila alekhya anusha aparna archana bindu chandana gayathri haritha jyothi kalyani lahari madhuri manasa nandini nikitha padma prathyusha radhika rekha roja sangeetha sirisha soujanya sushma tanvi usha vani vidya yamini aishwarya ananya diya isha kriti meera neha riya saanvi tara zara fatima ayesha sana mary'.split(' '));
const BOY=new Set('vishnu krishna rama siva shiva surya aditya chaitanya ravi hari sai rahul arjun karthik naveen praveen sandeep srinivas suresh ramesh mahesh rajesh venkat venkatesh vamshi vamsi akhil anil sunil kiran manikanta nikhil pavan prasad raju rakesh sai_kumar sathish shiva tarun teja uday varun vijay yashwanth abhishek ajay amit arun ashok bharath charan dinesh ganesh gopal harsha jagan kalyan kishore lokesh madhu mohan nagaraju nitin pranav rohit sachin sanjay sravan sudheer vinay vivek yash aarav vihaan reyansh ayaan mohammed imran john joseph'.split(' '));
// names that look 'female' by suffix but are usually male in Telugu/Indian usage
const MALE_A=/(krishna|rama|surya|aditya|chaitanya|siva|shiva|ganga?dhar|ramana|sudha?kar|bhaskara|eswara|narasimha|anantha|balarama|harsha|teja|ravi|hari|sai|mani|murali|bali|giri)$/;
export function guessBase(fullName=''){
  const first=(fullName.trim().toLowerCase().split(/[\s.]+/).find(w=>w.length>1)||'').replace(/[^a-z]/g,'');
  if(!first)return {base:'girl',confidence:0};
  if(GIRL.has(first))return {base:'girl',confidence:.95};
  if(BOY.has(first))return {base:'boy',confidence:.95};
  if(MALE_A.test(first))return {base:'boy',confidence:.7};
  if(/(a|aa|i|ee|ya|vi|mi|ini|ika|itha|atha|thi|shri|sri)$/.test(first))return {base:'girl',confidence:.6};
  if(/(esh|ash|ith|it|an|ar|al|ul|ush|ay|av|raj|deep|kumar|reddy|u)$/.test(first))return {base:'boy',confidence:.6};
  return {base:'boy',confidence:.4};
}
