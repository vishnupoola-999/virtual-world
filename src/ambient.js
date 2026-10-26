// Ambient creatures: a deterministic, client-only crowd across the world's cities so the map feels lived in when zoomed out.
// No Firestore reads or writes, no names, no pills. LOD:
//   zoom < 11       one GPU circle per creature (MapLibre circle layer, creature colour)
//   zoom 11..16     tiny creature silhouettes (one symbol layer, 6 shared 2D-canvas icons)
//   zoom >= 16      the few nearest on screen become real 3D creatures through world-agents (MAX_AMBIENT_LIVE), the rest stay silhouettes
import {CREATURES,CREATURE_COLOURS,ACCESSORIES} from './character-data.js';
// [lng, lat, weight] major cities and regions; India weighted up (most users are there).
export const CITIES=[
  [78.47,17.39,5],[79.59,17.98,4],[72.88,19.08,5],[77.21,28.61,5],[77.59,12.97,5],[80.27,13.08,4],[88.36,22.57,4],[73.86,18.52,3],[72.57,23.02,3],[75.79,26.91,2],
  [80.95,26.85,2],[76.27,9.93,2],[83.22,17.69,2],[85.32,23.34,1],[78.12,9.93,1],[74.12,15.49,1],[76.96,11.02,2],[81.63,21.25,1],[75.86,22.72,2],[91.74,26.14,1],
  [-74.01,40.71,4],[-118.24,34.05,3],[-87.63,41.88,2],[-122.42,37.77,3],[-79.38,43.65,2],[-99.13,19.43,3],[-46.63,-23.55,3],[-58.38,-34.6,2],[-43.17,-22.91,2],[-77.04,-12.05,1],
  [-0.13,51.51,4],[2.35,48.86,3],[13.4,52.52,2],[-3.7,40.42,2],[12.5,41.9,2],[4.9,52.37,1],[18.07,59.33,1],[37.62,55.76,2],[28.98,41.01,2],[23.73,37.98,1],
  [31.24,30.04,2],[3.38,6.52,2],[36.82,-1.29,1],[28.05,-26.2,2],[18.42,-33.92,1],[55.27,25.2,3],[46.68,24.71,1],[51.39,35.69,1],[67.0,24.86,2],[90.41,23.81,2],
  [100.5,13.76,2],[103.82,1.35,3],[106.85,-6.21,2],[121.47,31.23,3],[116.4,39.9,3],[114.17,22.32,2],[139.69,35.69,4],[135.5,34.69,2],[126.98,37.57,3],[121.0,14.6,2],
  [151.21,-33.87,3],[144.96,-37.81,2],[174.76,-36.85,1],[-123.12,49.28,1],[-71.06,42.36,1],[-80.19,25.76,2],[-96.8,32.78,1],[-157.86,21.31,1],[-149.9,61.22,1],[-21.94,64.15,1]];
export const AMBIENT_TOTAL=900,MAX_AMBIENT_LIVE=4,SILHOUETTE_Z=11,LIVE_Z=16;
// mulberry32: tiny seeded PRNG, so every device sees the same crowd.
function rng(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
// Pure, unit tested: [{id, lng, lat, creature, accessory}], deterministic for (seed, total).
export function ambientCreatures(seed=20261026,total=AMBIENT_TOTAL){const r=rng(seed),W=CITIES.reduce((s,c)=>s+c[2],0),out=[];
  for(const [lng,lat,w] of CITIES){const n=Math.max(4,Math.round(total*w/W));
    for(let i=0;i<n&&out.length<total;i++){const rad=Math.sqrt(-2*Math.log(r()+1e-9))*.022*(1+w*.12),ang=r()*Math.PI*2; // gaussian, ~2-4 km spread
      const la=lat+Math.sin(ang)*rad,ln=lng+Math.cos(ang)*rad/Math.max(.2,Math.cos(lat*Math.PI/180));
      out.push({id:'amb-'+out.length,lng:+ln.toFixed(5),lat:+la.toFixed(5),creature:CREATURES[Math.floor(r()*6)],accessory:r()<.55?'none':ACCESSORIES[1+Math.floor(r()*5)]});}}
  return out;}
// 2D silhouette icon for one creature: a soft body shape in its colour with two dark eye dots. 24x24 CSS px, drawn at 2x.
function silhouette(c){const s=48,cv=document.createElement('canvas');cv.width=cv.height=s;const g=cv.getContext('2d');g.fillStyle=CREATURE_COLOURS[c];g.beginPath();
  if(c==='mallow'){g.roundRect(13,10,22,30,9);}else if(c==='drip'){g.moveTo(24,6);g.bezierCurveTo(30,16,38,24,38,31);g.arc(24,31,14,0,Math.PI);g.bezierCurveTo(10,24,18,16,24,6);}
  else if(c==='pebble'){g.ellipse(24,30,17,11,0,0,Math.PI*2);}else if(c==='sprout'){g.ellipse(24,27,10,14,0,0,Math.PI*2);g.moveTo(24,13);g.ellipse(29,10,5,2.5,-.4,0,Math.PI*2);}
  else if(c==='puff'){g.arc(24,27,14,0,Math.PI*2);g.moveTo(14,18);g.ellipse(14,15,3.5,6,-.4,0,Math.PI*2);g.moveTo(34,18);g.ellipse(34,15,3.5,6,.4,0,Math.PI*2);}
  else{g.moveTo(10,40);g.bezierCurveTo(8,18,16,9,24,9);g.bezierCurveTo(32,9,40,18,38,40);g.closePath();}
  g.fill();g.strokeStyle='rgba(7,8,12,.55)';g.lineWidth=2;g.stroke();g.fillStyle='#0a0b10';const ey=c==='pebble'?29:c==='mallow'?22:c==='drip'?30:26;
  for(const x of [20,28]){g.beginPath();g.arc(x,ey,2.2,0,Math.PI*2);g.fill();}return g.getImageData(0,0,s,s);}
// Wire into a MapLibre map and the world-agents API. Returns {list, liveIds()} for tests.
export function setupAmbient(map,agents,{seed}={}){const list=ambientCreatures(seed);const live=new Set();
  const fc={type:'FeatureCollection',features:list.map(a=>({type:'Feature',id:+a.id.slice(4),geometry:{type:'Point',coordinates:[a.lng,a.lat]},properties:{c:a.creature,col:CREATURE_COLOURS[a.creature]}}))};
  function addLayers(){if(map.getSource('ambient'))return;
    for(const c of CREATURES){const k='amb-'+c;if(!map.hasImage(k))map.addImage(k,silhouette(c),{pixelRatio:2});}
    map.addSource('ambient',{type:'geojson',data:fc});
    const before=map.getLayer('ag-cluster')?'ag-cluster':undefined; // under people's agents and clusters
    map.addLayer({id:'amb-dot',type:'circle',source:'ambient',maxzoom:SILHOUETTE_Z,paint:{'circle-color':['get','col'],'circle-opacity':.95,
      'circle-radius':['interpolate',['linear'],['zoom'],1,2,5,2.8,10,4],'circle-stroke-width':1,'circle-stroke-color':'#07080c'}},before);
    map.addLayer({id:'amb-sil',type:'symbol',source:'ambient',minzoom:SILHOUETTE_Z,layout:{'icon-image':['concat','amb-',['get','c']],'icon-size':['interpolate',['linear'],['zoom'],11,.8,16,1.25],
      'icon-allow-overlap':true,'icon-anchor':'bottom','icon-pitch-alignment':'viewport'},paint:{'icon-opacity':['case',['boolean',['feature-state','live'],false],0,.95]}},before);}
  // Near the camera: promote the nearest few on screen to real creatures (world-agents keeps its own 8-live budget).
  function promote(){const want=new Set();if(map.getZoom()>=LIVE_Z&&map.getLayer('amb-sil')){const c=map.getCanvas(),w=c.clientWidth,h=c.clientHeight;
      const near=[];for(const a of list){const p=map.project([a.lng,a.lat]);if(p.x<-40||p.y<-60||p.x>w+40||p.y>h+60)continue;near.push([a,(p.x-w/2)**2+(p.y-h/2)**2]);}
      near.sort((x,y)=>x[1]-y[1]).slice(0,MAX_AMBIENT_LIVE).forEach(([a])=>want.add(a));}
    for(const id of live)if(![...want].some(a=>a.id===id)){agents.remove(id);live.delete(id);map.getSource('ambient')&&map.setFeatureState({source:'ambient',id:+id.slice(4)},{live:false});}
    for(const a of want)if(!live.has(a.id)){agents.put({id:a.id,name:'',lat:a.lat,lon:a.lng,look:{creature:a.creature,accessory:a.accessory},other:true,meta:''});agents.get(a.id)?.el.classList.add('ambient');live.add(a.id);
      map.setFeatureState({source:'ambient',id:+a.id.slice(4)},{live:true});}}
  if(map.isStyleLoaded())addLayers();map.on('style.load',addLayers);map.on('load',addLayers);
  let q=0;map.on('moveend',()=>{clearTimeout(q);q=setTimeout(promote,120);});
  return {list,liveIds:()=>[...live]};}
