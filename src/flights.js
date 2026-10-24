// Optional live-flights layer (off by default). Data: Render proxy /flights (adsb.lol / adsb.fi), around the map centre.
const URL_='https://virtual-world-ai.onrender.com/flights';
export function flightsLayer(map,{onMsg=()=>{}}={}){
  let on=false,timer=null;const empty={type:'FeatureCollection',features:[]};
  const ensure=()=>{if(map.getSource('flights'))return;map.addSource('flights',{type:'geojson',data:empty});
    map.addLayer({id:'flights',type:'symbol',source:'flights',layout:{'text-field':['concat','✈ ',['get','cs']],'text-size':12,'text-rotate':0,'text-allow-overlap':true,'text-anchor':'left','text-offset':[.4,0]},paint:{'text-color':'#eef2ff','text-halo-color':'#070b18','text-halo-width':1.5}});
    map.addLayer({id:'flights-dot',type:'circle',source:'flights',paint:{'circle-radius':5,'circle-color':'#5eb4ff','circle-stroke-color':'#070b18','circle-stroke-width':1.5}});};
  async function fetchNow(){if(!on)return;const c=map.getCenter();onMsg('⏳ fetching flights…');
    try{const r=await fetch(`${URL_}?lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}&r=135`);if(!r.ok)throw new Error('HTTP '+r.status);const j=await r.json();
      ensure();map.getSource('flights').setData({type:'FeatureCollection',features:j.ac.map(a=>({type:'Feature',geometry:{type:'Point',coordinates:[a.lon,a.lat]},properties:{cs:`${a.cs||a.hex} ${a.alt?Math.round(a.alt).toLocaleString()+' ft':'gnd'}`}}))});
      onMsg(`${j.ac.length} aircraft within 250 km (${j.src})`);window.__flights=j.ac.length;}
    catch(e){onMsg('⚠️ flights unavailable (proxy waking up?), retrying');window.__flights=-1;}}
  return {get on(){return on;},toggle(){on=!on;clearInterval(timer);
    if(on){fetchNow();timer=setInterval(fetchNow,15000);}else{map.getSource('flights')?.setData(empty);onMsg('');}
    if(map.getLayer('flights')){for(const id of ['flights','flights-dot'])map.setLayoutProperty(id,'visibility',on?'visible':'none');}return on;}};}
