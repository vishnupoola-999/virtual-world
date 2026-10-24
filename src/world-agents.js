// World tab v2 agents (design/world-v2-spec.md): HTML markers with a live character, a glass name pill and a status
// (idle / walking / talking / busy), your own agent with a glow, GPU clusters below zoom 14, and the agent profile sheet.
// This module has no three.js; the shared renderer (agent-renderer.js) is lazy-loaded once an agent is on screen at zoom ≥ 14.
// Budget: one WebGL context, 30 fps, at most 8 live characters (the rest get one static frame), paused off-screen,
// on the Chat tab and in the background. Only transform and opacity animate.
import {dragToClose} from './ui.js';
import {toLook} from './character-data.js';
const NEAR_Z=14,MAX_LIVE=8,FRAME_MS=33;
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
  function el(a){const d=document.createElement('div');d.className='ag'+(a.mine?' mine':'');d.setAttribute('role','button');d.tabIndex=0;
    d.innerHTML=`${a.mine?'<span class="halo"></span><span class="birth" aria-hidden="true"><i></i><i></i><em>Finding your spot…</em></span>':''}<span class="shadow"></span><div class="bob"><canvas width="112" height="128"></canvas></div>`+
      `<span class="bubble glass" hidden><b></b><b></b><b></b></span><span class="busy" hidden></span><span class="pill glass"><i></i>${a.mine?'You · ':''}<span class="agLabel"></span></span>`;
    // Tap opens the profile; a 500 ms long-press on your own agent starts Move my agent (PR #14).
    let lp=0,down=null,fired=false;const cancel=()=>{clearTimeout(lp);lp=0;};
    d.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];fired=false;if(a.mine)lp=setTimeout(()=>{lp=0;fired=true;navigator.vibrate?.(20);hooks.onLongPress?.(a);},500);});
    d.addEventListener('pointermove',e=>{if(down&&Math.hypot(e.clientX-down[0],e.clientY-down[1])>10)cancel();});
    for(const ev of ['pointerup','pointercancel','pointerleave'])d.addEventListener(ev,cancel);
    d.addEventListener('click',e=>{e.stopPropagation();if(!fired)openProfile(a);});
    d.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openProfile(a);}});
    return d;}
  function paint(a){const e=a.el;e.setAttribute('aria-label',`${a.name}'s agent${a.mine?' (you)':''}`);e.querySelector('.agLabel').textContent=a.name;
    e.classList.toggle('walking',a.state==='walking');e.querySelector('.bubble').hidden=a.state!=='talking';e.querySelector('.busy').hidden=a.state!=='busy';
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
  function frame(t){raf=0;if(paused()||!near()){if(prof&&R)drawProfile(0);return;}
    if(!R){loadR();return;} // warm the renderer as soon as an agent exists at street zoom, even off-screen
    const vis=[];const c=map.getCanvas(),w=c.clientWidth,h=c.clientHeight,cx=w/2,cy=h/2;
    for(const a of all.values()){const ll=a.marker.getLngLat(),q=map.project(ll);if(q.x<-80||q.y<-120||q.x>w+80||q.y>h+120)continue;vis.push([a,(q.x-cx)**2+(q.y-cy)**2-(a.mine?1e12:0)]);}
    if(!vis.length&&!prof)return;
    if(t-last>=FRAME_MS){const dt=last?Math.min(.1,(t-last)/1000):0;last=t;vis.sort((x,y)=>x[1]-y[1]);
      vis.forEach(([a],i)=>{const live=i<MAX_LIVE&&!REDUCED.matches;const anim=animFor(a);
        if(!live&&a.drawnKey===anim+JSON.stringify(a.look))return;blit(a,anim,live?dt:0);a.drawnKey=live?null:anim+JSON.stringify(a.look);});
      if(prof)drawProfile(dt);}
    raf=requestAnimationFrame(frame);}
  const animFor=a=>a.mine&&a.waveUntil>performance.now()?'wave':a.state==='walking'?'walk':a.state==='talking'?'talk':'idle';
  function blit(a,anim,dt){const src=R.draw(a.id,a.look,anim,dt);a.g.clearRect(0,0,112,128);a.g.drawImage(src,0,0);
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
    $('profile').classList.add('on');$('profScrim').classList.add('on');$('profile').setAttribute('aria-hidden','false');last=0;
    const cv=$('pAv');cv.getContext('2d').clearRect(0,0,144,144);if(!R)loadR();kick();if(R)drawProfile(0);}
  function closeProfile(){prof=null;$('profile')?.classList.remove('on');$('profScrim')?.classList.remove('on');$('profile')?.setAttribute('aria-hidden','true');}
  if($('profile')){$('profScrim').onclick=closeProfile;
    $('pActs').onclick=e=>{const b=e.target.closest('button');if(!b||!prof)return;const a=all.get(prof.id);closeProfile();if(a)hooks['on'+b.dataset.a]?.(a);};
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&prof)closeProfile();});
    dragToClose($('profile'),closeProfile);}

  // Friends' agents switch in Layers: hide everyone except you.
  function showFriends(on){for(const a of all.values())if(!a.mine){a.hidden=!on;a.el.style.visibility=on?'':'hidden';}syncSource();}
  return {put,remove,setState,openProfile,closeProfile,showFriends,get(id){return all.get(id);},configure(h){Object.assign(hooks,h);},
    // Your own agent, used by agent.js in place of the old full-screen 3D layer.
    mine:{set(a){if(!a){remove('me');return;}put({id:'me',mine:true,name:a.name||'My agent',lat:a.lat,lon:a.lon,look:a.look,ownerName:a.ownerName,meta:a.meta,status:a.status});},
      play(n){const a=all.get('me');if(!a)return;if(n==='walk'){a.state='walking';paint(a);setTimeout(()=>{if(a.state==='walking'){a.state='online';paint(a);}},900);}
        else if(n==='talk')setState('me','talking');else if(n==='idle')setState('me','online');kick();}}};}
