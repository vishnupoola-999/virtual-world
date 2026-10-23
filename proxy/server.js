// Tiny LLM proxy for the Virtual World (Node 18+, no dependencies). Keeps the API key server-side.
// Env: GEMINI_API_KEY (free key from https://aistudio.google.com/apikey), ALLOWED_ORIGIN (default https://vishnupoola-999.github.io)
// Deploy e.g. on Render: Web Service, root dir "proxy", build "true", start "node server.js", env GEMINI_API_KEY.
import http from 'node:http';
const KEY=process.env.GEMINI_API_KEY,ORIGIN=process.env.ALLOWED_ORIGIN||'https://vishnupoola-999.github.io',MODEL=process.env.MODEL||'gemini-2.0-flash';
const hits=new Map(); // naive per-IP rate limit: 20 req/min
http.createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin',ORIGIN);res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  if(req.method==='OPTIONS')return res.end();
  if(req.method==='GET')return res.end('ok');
  if(req.method!=='POST'||!req.url.startsWith('/chat')){res.statusCode=404;return res.end();}
  const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0],now=Date.now(),h=(hits.get(ip)||[]).filter(t=>now-t<60000);
  if(h.length>=20){res.statusCode=429;return res.end('{"error":"slow down"}');}h.push(now);hits.set(ip,h);
  let body='';for await(const c of req){body+=c;if(body.length>20000){res.statusCode=413;return res.end();}}
  try{const {messages=[],max_tokens=150}=JSON.parse(body);
    const sys=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
    const contents=messages.filter(m=>m.role!=='system').map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:String(m.content).slice(0,4000)}]}));
    const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({systemInstruction:{parts:[{text:sys}]},contents,generationConfig:{maxOutputTokens:Math.min(max_tokens,300),temperature:.9}})});
    const j=await r.json();const text=j.candidates?.[0]?.content?.parts?.map(p=>p.text).join('')||'';
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content:text}}]}));}
  catch(e){res.statusCode=500;res.end(JSON.stringify({error:String(e)}));}
}).listen(process.env.PORT||8787);
