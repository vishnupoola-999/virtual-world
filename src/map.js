import {LOW_END,MOBILE,terrainPref,setTerrainPref} from './device.js';
import {nextPixelRatio} from './pixel-ratio.js';
// World map: MapLibre GL v5 globe + OpenFreeMap vector tiles (keyless) in our night style + 3D buildings + AWS Terrarium terrain (keyless).
export const HOME={lng:79.53190,lat:18.00577,name:'100 Feet Road, Hanamkonda'};
// Night style (assets/map-style-night.json): sets globe projection, sky, and default heights for buildings with no height data.
const STYLE=new URL('../assets/map-style-night.json',import.meta.url).href;
const DEM='https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
// Crisp: the map draws at min(devicePixelRatio, 2) on every phone (it used to be 1 on low-end and 1.5 elsewhere, which looked blurry).
// adaptMapPixelRatio() steps it down (1.5, then 1) only if the map keeps rendering below 30 fps. Pitch stays 60 on low-end.
const PIXEL_RATIO=Math.min(Math.max(1,devicePixelRatio||1),2);
function adaptMapPixelRatio(map){let prev=0,n=0,sum=0;
  map.on('render',()=>{const t=performance.now(),d=t-prev;prev=t;if(d>100||document.hidden){n=0;sum=0;return;} // idle gaps don't count
    sum+=d;if(++n<90)return;const avg=sum/n;n=0;sum=0;const cur=map.getPixelRatio?.()??PIXEL_RATIO,nx=nextPixelRatio(cur,avg);
    window.__perf={...(window.__perf||{}),mapFrameMs:+avg.toFixed(1),pixelRatio:nx??cur};if(nx&&map.setPixelRatio)map.setPixelRatio(nx);});}
export function createMap(container,{center=HOME,zoom=16.3,pitch=60,bearing=-20,onToast}={}){
  const map=new maplibregl.Map({container,style:STYLE,center:[center.lng,center.lat],zoom,pitch,bearing,maxPitch:LOW_END?60:70,
    pixelRatio:PIXEL_RATIO,fadeDuration:0,maxTileCacheZoomLevels:LOW_END?3:5,hash:true,attributionControl:{compact:true}});
  adaptMapPixelRatio(map);
  map.addControl(new maplibregl.NavigationControl({visualizePitch:true,showZoom:innerWidth>=768}),'top-right');
  map.addControl(new maplibregl.ScaleControl(),'bottom-right');
  // Some POI icons are missing from the sprite; supply a blank so the console stays clean.
  map.on('styleimagemissing',e=>{if(!map.hasImage(e.id))map.addImage(e.id,{width:1,height:1,data:new Uint8Array(4)});});
  map.on('style.load',()=>{
    map.addSource('dem',{type:'raster-dem',tiles:[DEM],tileSize:256,encoding:'terrarium',maxzoom:15,attribution:'Terrain: Mapzen/AWS Terrain Tiles'});
    applyTerrain(map,terrainPref());
  });
  // "High quality 3D" switch in the Layers sheet (World v2); off by default on phones / low-end devices, and remembered.
  const sw=document.getElementById('swTerrain'),label=()=>sw?.setAttribute('aria-checked',String(terrainPref()));label();
  if(sw)sw.onclick=()=>{const on=!terrainPref();setTerrainPref(on);applyTerrain(map,on);label();onToast?.(on?'High quality 3D on':'High quality 3D off');};
  // Credits start collapsed to the ⓘ button (still one tap away, as the OSM licence requires).
  map.once('load',()=>{const b=map.getContainer().querySelector('.maplibregl-ctrl-attrib');b?.classList.remove('maplibregl-compact-show');b?.removeAttribute('open');});
  window.__perf={...(window.__perf||{}),LOW_END,MOBILE,pixelRatio:PIXEL_RATIO,terrain:terrainPref};
  return map;}
// Terrain + hillshade on/off. Hillshade only with terrain.
export function applyTerrain(map,on){if(!map.getSource('dem'))return;
  if(on){map.setTerrain({source:'dem',exaggeration:1.2});if(!map.getLayer('hillshade'))map.addLayer({id:'hillshade',type:'hillshade',source:'dem',paint:{'hillshade-exaggeration':.25,'hillshade-shadow-color':'#02040a','hillshade-highlight-color':'#1b2a55'}},
      map.getLayer('water')?'water':firstSymbol(map));}
  else{map.setTerrain(null);if(map.getLayer('hillshade'))map.removeLayer('hillshade');}}
function firstSymbol(map){return map.getStyle().layers.find(l=>l.type==='symbol')?.id;}
export const flyTo=(map,lng,lat,zoom=17)=>map.flyTo({center:[lng,lat],zoom,pitch:60,essential:true,speed:1.4});
export async function search(q){const r=await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q='+encodeURIComponent(q),{headers:{'Accept-Language':'en'}});if(!r.ok)throw new Error('search HTTP '+r.status);return r.json();}
