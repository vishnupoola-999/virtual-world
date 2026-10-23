// Family presence relay over ntfy.sh (free, keyless, HTTPS/443, CORS-enabled pub/sub that caches messages ~12 h).
// Joiners POST {id,name,lat,lon,ts} to the family topic every ~5 s; Stop POSTs {id,stop:true}.
// Viewers subscribe with Server-Sent Events and replay the last 150 s, so a freshly opened page sees everyone already live.
// Anyone whose last update is older than STALE_MS is dropped by the viewer.
export const RELAY='https://ntfy.sh';
export const STALE_MS=120000;
export function roomFromUrl(){const q=new URLSearchParams(location.search);const r=q.get('room')||localStorage.getItem('vw-room')||'poola-family-7f3k';localStorage.setItem('vw-room',r);return r.replace(/[^a-zA-Z0-9_-]/g,'');}
export function connect(room,{onPresence,onStatus}={}){
  const topic=`${RELAY}/vw1-${room}`;let es;
  const open=()=>{es=new EventSource(`${topic}/sse?since=150s`);
    es.onopen=()=>onStatus&&onStatus('connected');
    es.onerror=()=>onStatus&&onStatus('reconnecting…');
    es.onmessage=e=>{try{const m=JSON.parse(e.data);if(m.event!=='message')return;const d=JSON.parse(m.message);if(!d.id)return;
      if(!d.stop&&m.time*1000<Date.now()-STALE_MS)return;onPresence&&onPresence(d);}catch{}};};
  open();
  const post=d=>fetch(topic,{method:'POST',body:JSON.stringify(d),keepalive:true}).catch(()=>{});
  return {publish(id,d){return post({...d,id});},clear(id){return post({id,stop:true});},end(){es.close();}};
}
