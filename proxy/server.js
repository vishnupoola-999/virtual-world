// Tiny LLM proxy for the Virtual World (Node 18+, no dependencies). The API key stays server-side (env GEMINI_API_KEY).
// Abuse limits: Origin allow-list, per-IP 6 req/min, global 60 req/hour and 600 req/day, request size 8 KB, max 300 output tokens.
import http from 'node:http';
const KEY=process.env.GEMINI_API_KEY,ORIGINS=(process.env.ALLOWED_ORIGIN||'https://vishnupoola-999.github.io').split(','),MODEL=process.env.MODEL||'gemini-flash-lite-latest';
const MAX_OUT=300,PER_IP_MIN=6,GLOBAL_HOUR=60,GLOBAL_DAY=600;
const ipHits=new Map();const fcache=new Map();
// GET /flights?lat=&lon=&r=<nm>  -> slim live aircraft list from api.adsb.lol (no CORS there), cached 8 s per area
async function flights(u){const lat=+u.searchParams.get('lat'),lon=+u.searchParams.get('lon'),r=Math.min(250,Math.max(5,+u.searchParams.get('r')||80));
  if(!isFinite(lat)||!isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw new Error('bad');
  const k=lat.toFixed(2)+','+lon.toFixed(2)+','+Math.round(r),c=fcache.get(k);if(c&&Date.now()-c.t<8000)return c.v;
  const R=Math.round(r),srcs=[['adsb.lol',`https://api.adsb.lol/v2/point/${lat}/${lon}/${R}`],['adsb.fi',`https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${R}`]];let j,src,errs=[];
  for(const [n,url] of srcs){try{const x=await fetch(url,{headers:{'User-Agent':'virtual-world-proxy (github.com/vishnupoola-999/virtual-world)','Accept':'application/json'},signal:AbortSignal.timeout(8000)});
    if(!x.ok)throw new Error(n+' HTTP '+x.status);j=await x.json();j.ac=j.ac||j.aircraft;src=n;break;}catch(e){errs.push(String(e.message||e));}}
  if(!j){console.error('flights failed',errs);throw new Error(errs.join('; '));}
  const v=JSON.stringify({src,now:j.now,ac:(j.ac||[]).filter(a=>a.lat!=null).map(a=>({hex:a.hex,cs:(a.flight||a.r||a.hex||'').trim(),t:a.t,lat:a.lat,lon:a.lon,alt:a.alt_baro==='ground'?0:(a.alt_geom??a.alt_baro??0),gs:a.gs,trk:a.track}))});
  if(fcache.size>200)fcache.clear();fcache.set(k,{t:Date.now(),v});return v;}let hour=[],day=[];
http.createServer(async(req,res)=>{
  const origin=req.headers.origin||'';const ok=ORIGINS.includes(origin);
  if(ok){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');}
  if(req.method==='OPTIONS'){res.statusCode=ok?204:403;return res.end();}
  if(req.method==='GET'&&req.url.startsWith('/flights')){try{res.setHeader('Content-Type','application/json');return res.end(await flights(new URL(req.url,'http://x')));}catch(e){res.statusCode=502;return res.end(JSON.stringify({error:'flights unavailable',detail:String(e.message||e).slice(0,300)}));}}
  if(req.method==='GET'){return res.end('ok');} // health / wake-up
  if(req.method!=='POST'||!req.url.startsWith('/chat')){res.statusCode=404;return res.end();}
  if(!ok){res.statusCode=403;return res.end('{"error":"origin not allowed"}');}
  const now=Date.now(),ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
  const h=(ipHits.get(ip)||[]).filter(t=>now-t<60000);hour=hour.filter(t=>now-t<3600000);day=day.filter(t=>now-t<86400000);
  if(h.length>=PER_IP_MIN||hour.length>=GLOBAL_HOUR||day.length>=GLOBAL_DAY){res.statusCode=429;return res.end('{"error":"rate limited"}');}
  h.push(now);ipHits.set(ip,h);hour.push(now);day.push(now);if(ipHits.size>5000)ipHits.clear();
  let body='';for await(const c of req){body+=c;if(body.length>8000){res.statusCode=413;return res.end('{"error":"too big"}');}}
  try{const {messages=[],max_tokens=150}=JSON.parse(body);
    const sys=messages.filter(m=>m.role==='system').map(m=>String(m.content)).join('\n').slice(0,2000);
    const contents=messages.filter(m=>m.role!=='system').slice(-4).map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:String(m.content).slice(0,3000)}]}));
    const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':KEY},
      body:JSON.stringify({systemInstruction:{parts:[{text:sys}]},contents,generationConfig:{maxOutputTokens:Math.min(+max_tokens||150,MAX_OUT),temperature:.9}})});
    const j=await r.json();if(!r.ok){res.statusCode=502;return res.end(JSON.stringify({error:'upstream '+r.status}));}
    const text=j.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content:text}}]}));}
  catch(e){res.statusCode=500;res.end('{"error":"bad request"}');}
}).listen(process.env.PORT||8787);
