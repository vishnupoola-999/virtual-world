// Family members from opt-in sharing (src/family.js relay) drawn as avatar markers at their real coordinates.
import {STALE_MS} from './family.js';
export function familyLayer(map,{onChange=()=>{}}={}){
  const fam=new Map();
  function update(d){let f=fam.get(d.id);
    if(d.stop){if(f){f.marker.remove();fam.delete(d.id);onChange(fam);}return;}
    if(!(isFinite(d.lat)&&isFinite(d.lon)))return;if(Date.now()-(d.ts||0)>STALE_MS)return;
    const name=String(d.name||'Family').slice(0,24);
    if(!f){const el=document.createElement('div');el.className='fam';el.innerHTML='<div class="av"></div><div class="nm"></div>';
      f={el,marker:new maplibregl.Marker({element:el,anchor:'bottom'}).setLngLat([d.lon,d.lat]).addTo(map)};fam.set(d.id,f);
      el.onclick=()=>map.flyTo({center:[f.data.lon,f.data.lat],zoom:18,pitch:60});}
    f.data=d;f.el.querySelector('.av').textContent=name[0].toUpperCase();f.el.querySelector('.nm').textContent=name;f.marker.setLngLat([d.lon,d.lat]);onChange(fam);}
  setInterval(()=>{for(const [id,f] of fam)if(Date.now()-(f.data.ts||0)>STALE_MS)update({id,stop:true});},10000);
  return {fam,update};}
