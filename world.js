// Shared OSM -> local-metre conversion (used for live re-centring in the browser)
export function overpassQuery(lat,lon,r=1500){const a=`(around:${r},${lat},${lon})`;
 return `[out:json][timeout:90];(way["building"]${a};way["highway"]${a};way["landuse"]${a};way["leisure"~"park|garden|playground"]${a};node["shop"]${a};);out geom tags;`;}
export const OVERPASS=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter','https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
export async function fetchWorld(lat,lon,name,onStatus){const q=overpassQuery(lat,lon);let last;
 for(const u of OVERPASS){try{onStatus&&onStatus('Fetching OSM from '+new URL(u).host+'…');const r=await fetch(u,{method:'POST',body:'data='+encodeURIComponent(q),headers:{'Content-Type':'application/x-www-form-urlencoded'}});
  if(!r.ok)throw new Error('HTTP '+r.status);return toWorld(await r.json(),lat,lon,name);}catch(e){last=e;}}
 throw last;}
export function toWorld(d,LAT,LON,name){const R=6378137,kx=Math.cos(LAT*Math.PI/180)*Math.PI/180*R,ky=Math.PI/180*R;
 const p=(lat,lon)=>[+((lon-LON)*kx).toFixed(1),+(-(lat-LAT)*ky).toFixed(1)];
 const out={center:{lat:LAT,lon:LON,name},buildings:[],roads:[],areas:[],shops:[],parks:[]};
 const H=t=>{const h=parseFloat(t.height);if(h>0)return h;const l=parseFloat(t['building:levels']);if(l>0)return l*3.2;return 6+(JSON.stringify(t).length%3)*3;};
 for(const e of d.elements){const t=e.tags||{};
  if(e.type==='node'){out.shops.push({p:p(e.lat,e.lon),name:t.name||t.shop||'shop'});continue;}
  const g=(e.geometry||[]).map(q=>p(q.lat,q.lon));if(g.length<2)continue;
  if(t.building)out.buildings.push({pts:g,h:H(t),name:t.name});
  else if(t.highway)out.roads.push({pts:g,type:t.highway,name:t.name});
  else{const k=t.leisure||t.landuse;out.areas.push({pts:g,type:k});
   if(['park','garden','playground','recreation_ground','grass'].includes(k)){const c=[g.reduce((s,a)=>s+a[0],0)/g.length,g.reduce((s,a)=>s+a[1],0)/g.length];out.parks.push({p:c,name:t.name||k});}}}
 return out;}
export function project(W,lat,lon){const R=6378137;return [(lon-W.center.lon)*Math.PI/180*R*Math.cos(W.center.lat*Math.PI/180),-(lat-W.center.lat)*Math.PI/180*R];}
