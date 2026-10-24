// Optional live-flights layer (off by default). Data: Render proxy /flights (adsb.lol / adsb.fi), around the map centre.
// The proxy requires a Firebase ID token, the same one chat sends.
const URL_='https://virtual-world-ai.onrender.com/flights';
export async function flightAuthHeaders(user){
  if(!user||typeof user.getIdToken!=='function')return null;
  const token=await user.getIdToken();
  if(typeof token!=='string'||!token)return null;
  return {Authorization:`Bearer ${token}`};
}
export function flightsLayer(map,{onMsg=()=>{},getUser=()=>null}={}){
  let on=false,timer=null,paused=false;const empty={type:'FeatureCollection',features:[]};
  const ensure=()=>{if(map.getSource('flights'))return;map.addSource('flights',{type:'geojson',data:empty});
    map.addLayer({id:'flights',type:'symbol',source:'flights',layout:{'text-field':['concat','✈ ',['get','cs']],'text-size':12,'text-rotate':0,'text-allow-overlap':true,'text-anchor':'left','text-offset':[.4,0]},paint:{'text-color':'#eef2ff','text-halo-color':'#070b18','text-halo-width':1.5}});
    map.addLayer({id:'flights-dot',type:'circle',source:'flights',paint:{'circle-radius':5,'circle-color':'#5eb4ff','circle-stroke-color':'#070b18','circle-stroke-width':1.5}});};
  async function fetchNow(){if(!on||paused)return;
    let headers;try{headers=await flightAuthHeaders(getUser());}catch{headers=null;}
    if(!headers){onMsg('Sign in to see flights');window.__flights=-1;return;}
    const c=map.getCenter();onMsg('⏳ fetching flights…');
    try{const r=await fetch(`${URL_}?lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}&r=135`,{headers});
      if(r.status===401){onMsg('Sign in to see flights');window.__flights=-1;return;}
      if(!r.ok)throw new Error('HTTP '+r.status);const j=await r.json();
      ensure();map.getSource('flights').setData({type:'FeatureCollection',features:j.ac.map(a=>({type:'Feature',geometry:{type:'Point',coordinates:[a.lon,a.lat]},properties:{cs:`${a.cs||a.hex} ${a.alt?Math.round(a.alt).toLocaleString()+' ft':'gnd'}`}}))});
      onMsg(`${j.ac.length} aircraft within 250 km (${j.src})`);window.__flights=j.ac.length;}
    catch(e){onMsg('⚠️ flights unavailable (proxy waking up?), retrying');window.__flights=-1;}}
  // pause(true) while the Chat tab is open: no fetches or map updates until the World tab is back.
  return {get on(){return on;},pause(p){const was=paused;paused=!!p;if(was&&!paused)fetchNow();},toggle(){on=!on;clearInterval(timer);
    if(on){fetchNow();timer=setInterval(fetchNow,15000);}else{map.getSource('flights')?.setData(empty);onMsg('');}
    if(map.getLayer('flights')){for(const id of ['flights','flights-dot'])map.setLayoutProperty(id,'visibility',on?'visible':'none');}return on;}};}
