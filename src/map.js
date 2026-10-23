// World map: MapLibre GL v5 globe + OpenFreeMap vector tiles (keyless) + 3D buildings + AWS Terrarium terrain (keyless).
export const HOME={lng:79.53190,lat:18.00577,name:'100 Feet Road, Hanamkonda'};
const STYLE='https://tiles.openfreemap.org/styles/liberty';
const DEM='https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export function createMap(container,{center=HOME,zoom=16.3,pitch=60,bearing=-20}={}){
  const map=new maplibregl.Map({container,style:STYLE,center:[center.lng,center.lat],zoom,pitch,bearing,maxPitch:85,hash:true,attributionControl:{compact:true}});
  map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'top-right');
  map.addControl(new maplibregl.ScaleControl(),'bottom-right');
  // Some Liberty POI icons are missing from its sprite; supply a blank so the console stays clean.
  map.on('styleimagemissing',e=>{if(!map.hasImage(e.id))map.addImage(e.id,{width:1,height:1,data:new Uint8Array(4)});});
  map.on('style.load',()=>{
    map.setProjection({type:'globe'});
    map.addSource('dem',{type:'raster-dem',tiles:[DEM],tileSize:256,encoding:'terrarium',maxzoom:15,attribution:'Terrain: Mapzen/AWS Terrain Tiles'});
    map.setTerrain({source:'dem',exaggeration:1.2});
    map.addLayer({id:'hillshade',type:'hillshade',source:'dem',paint:{'hillshade-exaggeration':.25}},firstSymbol(map));
    // Liberty already ships a fill-extrusion "building-3d" layer; make it start earlier and look solid.
    if(map.getLayer('building-3d')){map.setLayerZoomRange('building-3d',13,24);map.setPaintProperty('building-3d','fill-extrusion-opacity',.85);}
  });
  return map;}
function firstSymbol(map){return map.getStyle().layers.find(l=>l.type==='symbol')?.id;}
export const flyTo=(map,lng,lat,zoom=17)=>map.flyTo({center:[lng,lat],zoom,pitch:60,essential:true,speed:1.4});
export async function search(q){const r=await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q='+encodeURIComponent(q),{headers:{'Accept-Language':'en'}});if(!r.ok)throw new Error('search HTTP '+r.status);return r.json();}
