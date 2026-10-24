// World map: MapLibre GL v5 globe + OpenFreeMap vector tiles (keyless) in our night style + 3D buildings + AWS Terrarium terrain (keyless).
export const HOME={lng:79.53190,lat:18.00577,name:'100 Feet Road, Hanamkonda'};
// Night style (assets/map-style-night.json): sets globe projection, sky, and default heights for buildings with no height data.
const STYLE=new URL('../assets/map-style-night.json',import.meta.url).href;
const DEM='https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const LOW_END=(navigator.hardwareConcurrency||8)<=4;
export function createMap(container,{center=HOME,zoom=16.3,pitch=60,bearing=-20}={}){
  const map=new maplibregl.Map({container,style:STYLE,center:[center.lng,center.lat],zoom,pitch,bearing,maxPitch:LOW_END?70:85,
    pixelRatio:Math.min(devicePixelRatio||1,2),hash:true,attributionControl:{compact:true}});
  map.addControl(new maplibregl.NavigationControl({visualizePitch:true,showZoom:innerWidth>=768}),'top-right');
  map.addControl(new maplibregl.ScaleControl(),'bottom-right');
  // Some POI icons are missing from the sprite; supply a blank so the console stays clean.
  map.on('styleimagemissing',e=>{if(!map.hasImage(e.id))map.addImage(e.id,{width:1,height:1,data:new Uint8Array(4)});});
  map.on('style.load',()=>{
    map.addSource('dem',{type:'raster-dem',tiles:[DEM],tileSize:256,encoding:'terrarium',maxzoom:15,attribution:'Terrain: Mapzen/AWS Terrain Tiles'});
    map.setTerrain({source:'dem',exaggeration:1.2});
    map.addLayer({id:'hillshade',type:'hillshade',source:'dem',paint:{'hillshade-exaggeration':.25,'hillshade-shadow-color':'#02040a','hillshade-highlight-color':'#1b2a55'}},
      map.getLayer('water')?'water':firstSymbol(map));
  });
  return map;}
function firstSymbol(map){return map.getStyle().layers.find(l=>l.type==='symbol')?.id;}
export const flyTo=(map,lng,lat,zoom=17)=>map.flyTo({center:[lng,lat],zoom,pitch:60,essential:true,speed:1.4});
export async function search(q){const r=await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q='+encodeURIComponent(q),{headers:{'Accept-Language':'en'}});if(!r.ok)throw new Error('search HTTP '+r.status);return r.json();}
