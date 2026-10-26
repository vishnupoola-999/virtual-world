// World tab v2 agents (design/world-v2-spec.md): HTML markers with a live character, a glass name pill and a status
// (idle / walking / talking / busy), your own agent with a glow, GPU clusters below zoom 14, and the agent profile sheet.
// This module has no three.js; the shared renderer (agent-renderer.js) is lazy-loaded once an agent is on screen at zoom ≥ 14.
// Budget: one WebGL context, 30 fps, at most 8 live characters (the rest get one static frame), paused off-screen,
// on the Chat tab and in the background. Only transform and opacity animate.
import {dragToClose} from './ui.js';
import {toLook} from './character-data.js';
const basePR=()=>Math.min(Math.max(1,globalThis.devicePixelRatio||1),3); // same cap as agent-renderer.js (kept here so three.js stays lazy)
const NEAR_Z=14,MAX_LIVE=8,FRAME_MS=15; // ~60 fps; the frame monitor still drops pixel ratio on slow phones
const REDUCED=matchMedia('(prefers-reduced-motion: reduce)');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STATUS_COL={online:'#3ddc97',walking:'#3ddc97',talking:'#4fd1ff',busy:'#ffc861'};
let inst=null;
// One instance per map, shared by agent.js (your agent), family-layer.js (family / friends) and main.js (sheet actions).
export function agentsOnMap(map){return inst||=create(map);}
function create(map){
  const all=new Map();let R=null,rLoad=null,raf=0,last=0,hooks={},prof=null,srcTimer=0;
  const near=()=>map.getZoom()>=NEAR_Z;
  const paused=()=>document.hidden||document.body.dataset.tab==='chat';
  const loadR=()=>rLoad||=import('./agent-renderer.js').then(m=>{R=m.sharedRenderer();window.__avatarReady=true;kick();return R;})
    .catch(e=>{rLoad=null;console.warn('agent renderer',e?.message);});
  function el(a){const d=document.createElement('div');d.className='ag'+(a.mine?' mine':'')+(a.other?' other':'');d.setAttribute('role','button');d.tabIndex=0;
    d.innerHTML=`${a.mine?'<span class="halo"></span><span class="birth" aria-hidden="true"><i></i><i></i><em>Finding your spot…</em></span>':''}<span class="shadow"></span><div class="bob"><canvas width="${Math.round(84*basePR())}" height="${Math.round(96*basePR())}"></canvas></div>`+
      `<span class="stat glass" hidden></span><span class="bubble glass" hidden><b></b><b></b><b></b></span><span class="busy" hidden></span><span class="pill glass"><i></i>${a.mine?'You · ':''}<span class="agLabel"></span></span>`;
    // Tap opens the profile; a 500 ms long-press on your own agent starts Move my agent (PR #14).
    let lp=0,down=null,fired=false;const cancel=()=>{clearTimeout(lp);lp=0;};
    d.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];fired=false;if(a.mine)lp=setTimeout(()=>{lp=0;fired=true;navigator.vibrate?.(20);hooks.onLongPress?.(a);},500);});
    d.addEventListener('pointermove',e=>{if(down&&Math.hypot(e.clientX-down[0],e.clientY-down[1])>10)cancel();});
    for(const ev of ['pointerup','pointercancel','pointerleave'])d.addEventListener(ev,cancel);
    d.addEventListener('click',e=>{e.stopPropagation();if(!fired)openProfile(a);});
    d.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openProfile(a);}});
    return d;}
  function paint(a){const e=a.el;e.setAttribute('aria-label',`${a.name}'s agent${a.mine?' (you)':''}`);e.querySelector('.agLabel').textContent=a.name;
    const L=a.living,meet=L?.kind==='meeting';e.classList.toggle('walking',a.state==='walking'||L?.kind==='walking');
    const bb=e.querySelector('.bubble');bb.hidden=a.state!=='talking'&&!(meet&&a.mine);bb.classList.toggle('big',meet&&a.mine);
    // Living status pill above the head (living.js builds the trusted inner HTML from escaped text).
    const st=e.querySelector('.stat'),html=L&&L.kind!=='idle'&&L.html||'';if(st.dataset.h!==html){st.dataset.h=html;st.innerHTML=html;st.hidden=!html;}e.querySelector('.busy').hidden=a.state!=='busy';
    e.querySelector('.pill i').hidden=a.state==='busy';a.drawnKey=null;}
  // Adds or updates one agent. a = {id, name, lat, lon, look, ownerName, mine, state, meta, status}
  function put(d){let a=all.get(d.id);const look=toLook(d.look,d.ownerName||d.name);
    if(!a){a={...d,look,state:d.state||'online'};a.el=el(a);a.g=a.el.querySelector('canvas').getContext('2d');
      a.marker=new maplibregl.Marker({element:a.el,anchor:'bottom',offset:[0,-6]}).setLngLat([d.lon,d.lat]).addTo(map);all.set(d.id,a);
      if(a.mine)a.anim='wave',a.waveUntil=performance.now()+2300;}
    else{const moved=a.lat!==d.lat||a.lon!==d.lon;const from=[a.lon,a.lat];Object.assign(a,d,{look,state:d.state||a.state});
      if(moved)walkTo(a,from,[d.lon,d.lat]);}
    a.el.classList.toggle('far',!near());paint(a);syncSource();kick();return a;}
  // Short moves walk (marker slides via MapLibre's transform); long jumps teleport.
  function walkTo(a,from,to){cancelAnimationFrame(a.walkRaf);const dist=Math.hypot((to[0]-from[0])*Math.cos(to[1]*Math.PI/180),to[1]-from[1])*111320;
    if(dist>150||REDUCED.matches||document.hidden){a.marker.setLngLat(to);return;}
    const keep=a.state;a.state='walking';paint(a);const t0=performance.now(),T=Math.min(1600,300+dist*12);
    const step=t=>{const f=Math.min(1,(t-t0)/T);a.marker.setLngLat([from[0]+(to[0]-from[0])*f,from[1]+(to[1]-from[1])*f]);
      if(f<1)a.walkRaf=requestAnimationFrame(step);else{a.state=keep==='walking'?'online':keep;paint(a);}};a.walkRaf=requestAnimationFrame(step);}
  function remove(id){const a=all.get(id);if(!a)return;cancelAnimationFrame(a.walkRaf);a.marker.remove();all.delete(id);R?.drop(id);if(prof?.id===id)closeProfile();syncSource();}
  function setState(id,s){const a=all.get(id);if(!a||a.state===s)return;a.state=s;paint(a);kick();}

  // ---- the 30 fps loop: nearest 8 on-screen agents animate, others get one static frame
  function kick(){if(!raf&&all.size)raf=requestAnimationFrame(frame);}
  // Frame-time monitor: if the average frame (rAF to rAF) stays above 33 ms (below 30 fps) over 60 frames, step the pixel ratio down (3 -> 2 -> 1.5).
  const mon={n:0,sum:0,prev:0};
  function watch(t){if(mon.prev){mon.sum+=t-mon.prev;mon.n++;}mon.prev=t;
    if(mon.n>=60){const avg=mon.sum/mon.n;mon.n=0;mon.sum=0;window.__vwPerf={...(window.__vwPerf||{}),mapFrameMs:+avg.toFixed(2),mapPR:R?.pixelRatio};
      if(avg>1000/30&&R&&R.pixelRatio>1.5){R.setPixelRatio(R.pixelRatio>2?2:1.5);for(const a of all.values())a.drawnKey=null;}}}
  function frame(t){raf=0;watch(t);if(paused()||!near()){mon.prev=0;if(prof&&R)drawProfile(0);return;}
    if(!R){loadR();return;} // warm the renderer as soon as an agent exists at street zoom, even off-screen
    const vis=[];const c=map.getCanvas(),w=c.clientWidth,h=c.clientHeight,cx=w/2,cy=h/2;
    for(const a of all.values()){const ll=a.marker.getLngLat(),q=map.project(ll);if(q.x<-80||q.y<-120||q.x>w+80||q.y>h+120)continue;vis.push([a,(q.x-cx)**2+(q.y-cy)**2-(a.mine?1e12:0)]);}
    if(!vis.length&&!prof)return;
    if(t-last>=FRAME_MS){const dt=last?Math.min(.1,(t-last)/1000):0;last=t;vis.sort((x,y)=>x[1]-y[1]);
      vis.forEach(([a],i)=>{const live=i<MAX_LIVE&&!REDUCED.matches;const anim=animFor(a);
        if(!live&&a.drawnKey===anim+JSON.stringify(a.look))return;blit(a,anim,live?dt:0);a.drawnKey=live?null:anim+JSON.stringify(a.look);});
      if(prof)drawProfile(dt);}
    raf=requestAnimationFrame(frame);}
  const animFor=a=>a.mine&&a.waveUntil>performance.now()?'wave':a.state==='walking'||a.living?.kind==='walking'?'walk':a.state==='talking'||(a.living?.kind==='meeting'&&a.mine)?'talk':'idle';
  // Eased turn: a.yaw is the target (undefined = the renderer's default -0.3); a.yawNow follows it (~250 ms), snapping when static or reduced motion.
  function easeYaw(a,dt){const t=typeof a.yaw==='number'?a.yaw:-.3;if(typeof a.yawNow!=='number'||!dt||REDUCED.matches)a.yawNow=t;else a.yawNow+=(t-a.yawNow)*Math.min(1,dt*10);
    if(Math.abs(t-a.yawNow)<.002)a.yawNow=t;return a.yawNow;}
  function blit(a,anim,dt){const src=R.draw(a.id,a.look,anim,dt,undefined,easeYaw(a,dt)),cv=a.g.canvas;
    if(cv.width!==src.width||cv.height!==src.height){cv.width=src.width;cv.height=src.height;}
    a.g.clearRect(0,0,cv.width,cv.height);a.g.drawImage(src,0,0);
    if(!a.born){a.born=true;a.el.classList.add('born');}} // birth pulse fades out, character scales and fades in (CSS)
  function drawProfile(dt){const a=all.get(prof.id),cv=document.getElementById('pAv');if(!a||!cv||!R)return;const src=R.draw(a.id,a.look,animFor(a),dt,'portrait');
    const g=cv.getContext('2d');g.clearRect(0,0,144,144);g.drawImage(src,9,0,126,144);}
  const onZoom=()=>{const n=near();for(const a of all.values())a.el.classList.toggle('far',!n);if(n)kick();};
  // Warm the 3D code (three.js ~170 KB gz from the CDN + character.js) as soon as the map is ready, in parallel with sign-in
  // and the agent fetch, so the character is ready when the agent lands instead of starting the download only then.
  const warm=()=>(window.requestIdleCallback||setTimeout)(()=>loadR(),{timeout:1500});
  if(map.loaded())warm();else map.once('load',warm);
  map.on('zoom',onZoom);map.on('move',kick);
  document.addEventListener('visibilitychange',()=>{last=0;kick();});
  new MutationObserver(()=>{last=0;kick();}).observe(document.body,{attributes:true,attributeFilter:['data-tab']});

  // ---- clusters below zoom 14: GeoJSON cluster source + GPU circles (no DOM per agent)
  const fc=()=>({type:'FeatureCollection',features:[...all.values()].filter(a=>!a.hidden).map(a=>({type:'Feature',properties:{me:a.mine?1:0,id:a.id},geometry:{type:'Point',coordinates:[a.lon,a.lat]}}))});
  function syncSource(){clearTimeout(srcTimer);srcTimer=setTimeout(()=>{map.getSource('agents')?.setData(fc());},120);}
  function addLayers(){if(map.getSource('agents'))return;
    map.addSource('agents',{type:'geojson',data:fc(),cluster:true,clusterRadius:46,clusterMaxZoom:13.9,clusterProperties:{me:['max',['get','me']]}});
    const me=['==',['get','me'],1];
    map.addLayer({id:'ag-cluster-halo',type:'circle',source:'agents',maxzoom:NEAR_Z,filter:['has','point_count'],paint:{'circle-radius':['step',['get','point_count'],22,10,28,30,34],'circle-color':['case',me,'#8b7bff','#4fd1ff'],'circle-opacity':.16}});
    map.addLayer({id:'ag-cluster',type:'circle',source:'agents',maxzoom:NEAR_Z,filter:['has','point_count'],paint:{'circle-radius':['step',['get','point_count'],15,10,19,30,23],'circle-color':'#141722','circle-stroke-width':1.5,'circle-stroke-color':['case',me,'#8b7bff','#4fd1ff']}});
    map.addLayer({id:'ag-count',type:'symbol',source:'agents',maxzoom:NEAR_Z,filter:['has','point_count'],layout:{'text-field':['get','point_count_abbreviated'],'text-font':['Noto Sans Bold'],'text-size':12.5,'text-allow-overlap':true},paint:{'text-color':'#f3f5fa'}});
    map.addLayer({id:'ag-dot',type:'circle',source:'agents',maxzoom:NEAR_Z,filter:['!',['has','point_count']],paint:{'circle-radius':5,'circle-color':['case',me,'#8b7bff','#4fd1ff'],'circle-stroke-width':2,'circle-stroke-color':'#07080d'}});}
  if(map.isStyleLoaded())addLayers();map.on('style.load',addLayers);map.on('load',addLayers);
  map.on('click','ag-cluster',e=>{const f=e.features[0];map.getSource('agents').getClusterExpansionZoom(f.properties.cluster_id).then(z=>map.easeTo({center:f.geometry.coordinates,zoom:Math.max(z+.3,NEAR_Z),duration:500}));});
  map.on('click','ag-dot',e=>{const f=e.features[0];map.easeTo({center:f.geometry.coordinates,zoom:Math.max(map.getZoom()+2,NEAR_Z+1),duration:500});});
  for(const l of ['ag-cluster','ag-dot']){map.on('mouseenter',l,()=>{map.getCanvas().style.cursor='pointer';});map.on('mouseleave',l,()=>{map.getCanvas().style.cursor='';});}

  // ---- agent profile sheet (§c): friends get Visit + Chat, your own agent Move home + Customize
  const $=id=>document.getElementById(id);
  const PIN='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
  function openProfile(a){if(!$('profile'))return;prof={id:a.id};
    $('pName').innerHTML=esc(a.name)+(a.mine?'<span class="tag">You</span>':'');$('pMeta').textContent=a.meta||(a.mine?'Your agent':'Family');
    const st=a.state==='walking'?'walking':a.state==='talking'?'talking':a.state==='busy'?'busy':'online';const col=STATUS_COL[st];
    $('pStatus').textContent=a.status||({online:'Online · ready to help',walking:'Walking',talking:'Talking',busy:'Busy'}[st]);
    $('pDot').style.background=col;$('pDot').style.boxShadow=`0 0 0 4px ${col}22`;
    $('pActs').innerHTML=a.mine?`<button class="secondary" data-a="move" type="button">${PIN}Move home</button><button class="primary" data-a="custom" type="button">Customize</button>`
      :'<button class="secondary" data-a="visit" type="button">Visit</button><button class="primary" data-a="chat" type="button">Chat</button>';
    if($('pInterests'))$('pInterests').hidden=!a.mine;
    $('profile').classList.add('on');$('profScrim').classList.add('on');$('profile').setAttribute('aria-hidden','false');last=0;
    const cv=$('pAv');cv.getContext('2d').clearRect(0,0,144,144);if(!R)loadR();kick();if(R)drawProfile(0);}
  function closeProfile(){prof=null;$('profile')?.classList.remove('on');$('profScrim')?.classList.remove('on');$('profile')?.setAttribute('aria-hidden','true');}
  if($('profile')){$('profScrim').onclick=closeProfile;
    $('pActs').onclick=e=>{const b=e.target.closest('button');if(!b||!prof)return;const a=all.get(prof.id);closeProfile();if(a)hooks['on'+b.dataset.a]?.(a);};
    if($('pInterests'))$('pInterests').onclick=()=>{const a=prof&&all.get(prof.id);closeProfile();if(a)hooks.oninterests?.(a);};
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&prof)closeProfile();});
    dragToClose($('profile'),closeProfile);}

  // Friends' agents switch in Layers: hide everyone except you.
  function showFriends(on){for(const a of all.values())if(!a.mine){a.hidden=!on;a.el.style.visibility=on?'':'hidden';}syncSource();}
  // Living state for one agent: {kind:'walking'|'meeting'|'working'|'idle', html} plus an optional yaw (radians, map view only).
  function setLiving(id,living,yaw){const a=all.get(id);if(!a)return;a.living=living||null;a.yaw=yaw;a.drawnKey=null;paint(a);kick();}
  // One portrait frame of an agent into a 2D canvas (the away-card header avatar); loads the shared renderer if needed.
  function portrait(id,cv,anim,dt){const a=all.get(id);if(!a)return false;if(!R){loadR();return false;}const src=R.draw(a.id,a.look,anim||'idle',dt||0,'portrait');
    const g=cv.getContext('2d');g.clearRect(0,0,cv.width,cv.height);g.drawImage(src,0,0,src.width,src.width,0,0,cv.width,cv.height);a.drawnKey=null;kick();return true;}
  return {get renderInfo(){return R?{size:R.size,pixelRatio:R.pixelRatio,antialias:R.antialias}:null;},put,remove,setState,setLiving,portrait,openProfile,closeProfile,showFriends,get(id){return all.get(id);},configure(h){Object.assign(hooks,h);},
    // Your own agent, used by agent.js in place of the old full-screen 3D layer.
    mine:{set(a){if(!a){remove('me');return;}put({id:'me',mine:true,name:a.name||'My agent',lat:a.lat,lon:a.lon,look:a.look,ownerName:a.ownerName,meta:a.meta,status:a.status});},
      play(n){const a=all.get('me');if(!a)return;if(n==='walk'){a.state='walking';paint(a);setTimeout(()=>{if(a.state==='walking'){a.state='online';paint(a);}},900);}
        else if(n==='talk')setState('me','talking');else if(n==='idle')setState('me','online');kick();}}};}
