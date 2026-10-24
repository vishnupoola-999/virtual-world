// Family members from opt-in sharing (src/family.js relay) drawn as agents on the World map (world-agents.js),
// at the position they chose to share live. Tap one for its profile (Visit / Chat).
import {STALE_MS} from './family.js';
import {agentsOnMap} from './world-agents.js';
export function familyLayer(map,{onChange=()=>{}}={}){
  const fam=new Map(),queued=new Map(),agents=agentsOnMap(map);let paused=false;
  // While paused (Chat tab), keep only the latest update per person and apply them on resume.
  function update(d){if(paused){queued.set(d.id,d);return;}const f=fam.get(d.id);
    if(d.stop){if(f){agents.remove('f-'+d.id);fam.delete(d.id);onChange(fam);}return;}
    if(!(isFinite(d.lat)&&isFinite(d.lon)))return;if(Date.now()-(d.ts||0)>STALE_MS)return;
    const name=String(d.name||'Family').slice(0,24);
    fam.set(d.id,{data:d});
    agents.put({id:'f-'+d.id,name,lat:d.lat,lon:d.lon,look:d.look||null,ownerName:name,meta:'Family · sharing live location',status:'Online · sharing live location'});
    onChange(fam);}
  setInterval(()=>{for(const [id,f] of fam)if(Date.now()-(f.data.ts||0)>STALE_MS)update({id,stop:true});},10000);
  return {fam,update,pause(p){paused=!!p;if(!paused){const q=[...queued.values()];queued.clear();q.forEach(update);}}};}
