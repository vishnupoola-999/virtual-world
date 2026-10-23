// Agent "brain" v2: needs + memory + relationships + rule-based dialogue, with a pluggable LLM hook.
// No API key is ever shipped in this public site. LLM is OFF by default (rules only).
// Turn it on by deploying proxy/ (key stays server-side) and setting LLM_PROXY below, or per-visit with ?llm=https://<proxy>/chat
const Q=new URLSearchParams(location.search);
export const LLM_PROXY='https://virtual-world-ai.onrender.com/chat';
const LLM_URL=Q.get('llm')==='off'?null:(Q.get('llm')||LLM_PROXY||null);
const PERSONA={Ravi:'cheerful kirana shopkeeper, 50, loves cricket and bargaining',Meera:'patient school teacher, 34, tutors kids at the park in the evening',
 Arjun:'curious local reporter, 27, collects gossip for his daily neighbourhood news',Priya:'college student, 19, worried about exams, loves biryani',
 Kiran:'software engineer, 29, works from home, talks about traffic and startups',Lakshmi:'retired grandmother, 66, knows everyone, gives advice',
 Sai:'auto-rickshaw driver, 41, funny, complains about petrol prices',Anil:'gym-going delivery rider, 24, always in a hurry'};
const TOPICS=['traffic on 100 Feet Road','the weather','cricket','exam results','vegetable prices','the new metro line','a wedding next week','the power cut','biryani','the park cleanup'];
const pick=a=>a[Math.floor(Math.random()*a.length)];
export class Brain{
 constructor(env){this.env=env;this.llm={url:LLM_URL,busy:false,next:0,ok:0,fail:0,gap:30000};this.pending=[];this.aiCool=new Map();this.batchAt=performance.now()+5000;
  if(LLM_URL)fetch(LLM_URL.replace(/\/chat$/,'/'),{mode:'no-cors'}).catch(()=>{}); this.facts=[];this.cool=new Map(); // ^ wakes a cold free-tier proxy
  const hud=document.getElementById('hud');this.hudEl=document.createElement('div');this.hudEl.style.fontSize='11px';hud&&hud.insertBefore(this.hudEl,document.getElementById('msg'));this.hud();}
 hud(){this.hudEl.textContent=`🧠 AI: ${this.llm.url?'Gemini via proxy':'rules only'} · ${this.llm.ok} AI batches · ${this.aiLines||0} AI lines${this.llm.fail?' · '+this.llm.fail+' fallbacks (rules used)':''}`;}
 reset(A,places){this.A=A;this.places=places;
  for(const a of A){a.persona=PERSONA[a.name]||'neighbour';a.needs={hunger:Math.random()*.4,social:.3+Math.random()*.4,energy:.9};a.mood=.6;a.mem=[];a.rel={};}}
 remember(a,s){a.mem.unshift(s);if(a.mem.length>8)a.mem.pop();}
 // --- planning: needs override generic routines ---
 override(a,h){const n=a.needs;if(h<6||h>=22)return null;
  if(n.hunger>.75)return {dest:a.gen.shop,status:'😋 Hungry – going to '+a.gen.shop.name};
  if(n.energy<.2)return {dest:a.home,status:'🥱 Tired – heading home'};
  if(n.social>.8&&h>=10&&h<20)return {dest:a.gen.park,status:'👋 Lonely – looking for company at '+a.gen.park.name};
  return null;}
 tick(dt){if(performance.now()>this.batchAt){this.batchAt=performance.now()+5000;this.flushAI();}const k=dt*(window.S?S.speed:60)/3600;for(const a of this.A||[]){const n=a.needs;n.hunger=Math.min(1,n.hunger+.06*k);n.social=Math.min(1,n.social+.05*k);
   const h=this.env.clock().h;n.energy=Math.max(0,Math.min(1,n.energy+(h<6||h>=22?.15:-.04)*k));
   if(a.goal&&a.ri>=a.route.length&&a.goal.name&&a.status.match(/Shop|Hungry/))n.hunger=Math.max(0,n.hunger-.5*k*4);}}
 onHour(h,{parkName}){const n=this.env.addNews;if(h==8){n('Ravi opened his shop.');n('Meera started class at school.');}if(h==17)n('Meera is tutoring kids at '+parkName+'.');if(h==21)n('Ravi closed his shop for the day.');
  if(h==20)this.headline();}
 // --- encounters ---
 meet(a,b){const key=[a.name,b.name].sort().join('|'),now=performance.now();if((this.cool.get(key)||0)>now||a.sayT>0||b.sayT>0)return;this.cool.set(key,now+20000);
  a.rel[b.name]=(a.rel[b.name]||0)+.1;b.rel[a.name]=(b.rel[a.name]||0)+.1;a.needs.social=Math.max(0,a.needs.social-.4);b.needs.social=Math.max(0,b.needs.social-.4);
  const [l1,l2,fact]=this.ruleDialogue(a,b);this.say(a,l1);setTimeout(()=>this.say(b,l2),1200);
  if(fact){this.spread(a,b,fact);}
  if(a.role=='reporter'||b.role=='reporter'){const rep=a.role=='reporter'?a:b,src=rep===a?b:a;rep.route=[];rep.goal=null;}
  this.queueAI(a,b);}
 say(a,t){a.say=t;a.sayT=t.startsWith('✨')?7:4;}
 spread(a,b,fact){this.remember(a,fact);this.remember(b,fact);if(!this.facts.includes(fact)){this.facts.unshift(fact);if(this.facts.length>30)this.facts.pop();}
  if(a.role=='reporter'||b.role=='reporter')this.env.addNews(fact);}
 ruleDialogue(a,b){const h=this.env.clock().h,friend=(a.rel[b.name]||0)>.3,greet=h<12?'Good morning':h<17?'Namaste':'Good evening';
  const heard=b.mem.find(m=>!a.mem.includes(m));
  if(a.role=='shopkeeper'&&a.status.includes('open'))return [`${greet} ${b.name}! Fresh stock today, special price for you 🙂`,b.needs.hunger>.5?'Give me some rice and a packet of biscuits!':'Just looking, Ravi garu.',null];
  if(a.role=='reporter'||b.role=='reporter'){const rep=a.role=='reporter'?a:b,src=rep===a?b:a,t=pick(TOPICS);
   const fact=heard&&Math.random()<.5?`${src.name} repeated the rumour: “${heard.replace(/^.*?: /,'')}”`:`${src.name} (${src.persona.split(',')[0]}) is talking about ${t}.`;
   return rep===a?[`${src.name}, anything new for today's news?`,`Arjun, did you hear about ${t}?`,fact]:[`Arjun, did you hear about ${t}?`,`Tell me more, ${src.name}! Going in tonight's news 📰`,fact];}
  if(a.role=='teacher')return [`${b.name}, how are your studies going?`,b.name=='Priya'?'Exams are scary, Meera madam!':'Busy as always, madam.',null];
  if(heard)return [friend?`Arey ${b.name}! What's the latest?`:`${greet}, ${b.name}.`,`I heard: ${heard}`,`${b.name} told ${a.name}: ${heard}`];
  const t=pick(TOPICS);return [friend?`${b.name}! Long time, how's ${t}?`:`${greet}. Crazy ${t} today, no?`,a.needs.hunger>.6?'Let\'s get chai, I\'m starving.':'Ha, true! See you around.',`${a.name} and ${b.name} chatted about ${t}.`];}
 // --- LLM hook (optional, rate-limited, always falls back to rules) ---
 async chat(messages,max=120){const L=this.llm;if(!L.url||L.busy||performance.now()<L.next)return null;L.busy=true;L.next=performance.now()+L.gap;
  try{const ctl=new AbortController(),to=setTimeout(()=>ctl.abort(),20000);
   let c;
   {
    const r=await fetch(L.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages,max_tokens:max}),signal:ctl.signal});
    if(!r.ok)throw new Error(r.status);const j=await r.json();c=j.choices&&j.choices[0].message.content;}
   clearTimeout(to);if(!c||c.trim().startsWith('{"error'))throw new Error('empty');L.ok++;return c.trim();}
  catch(e){L.fail++;L.next=performance.now()+L.gap*3;return null;}finally{L.busy=false;this.hud();}}
 // Throttled + batched: each agent gets at most one AI line per 3 real minutes; up to 4 encounters per request; one request per >=30 s.
 queueAI(a,b){if(!this.llm.url)return;const now=performance.now(),cd=180000;
  if((this.aiCool.get(a.name)||0)>now||(this.aiCool.get(b.name)||0)>now||this.pending.some(p=>p.includes(a)||p.includes(b)))return;
  this.pending.push([a,b]);if(this.pending.length>4)this.pending.shift();}
 async flushAI(){if(!this.pending.length||this.llm.busy||performance.now()<this.llm.next)return;const batch=this.pending.splice(0,4),c=this.env.clock();
  const sys='You write very short, friendly street dialogue for characters in a simulated Hanamkonda (Warangal) neighbourhood. Light Telugu/Hindi words ok. Family-friendly. For EACH numbered encounter return an item. Reply ONLY with a JSON array: [{"a":"<line by first person>","b":"<reply by second>","fact":"<one short neighbourhood news item or empty>"}]. Max 14 words per line.';
  const desc=p=>`${p.name} (${p.persona}; now: ${p.status.replace(/[^\w\s:'-]/g,'').trim()}; remembers: ${p.mem.slice(0,2).join(' / ')||'nothing'})`;
  const u=`Time ${c.str}.\n`+batch.map(([a,b],i)=>`${i+1}. ${desc(a)} meets ${desc(b)}.`).join('\n');
  const out=await this.chat([{role:'system',content:sys},{role:'user',content:u}],60+70*batch.length);if(!out)return; // rules already spoke; nothing lost
  try{const arr=JSON.parse(out.slice(out.indexOf('['),out.lastIndexOf(']')+1)),clip=x=>String(x||'').slice(0,140),now=performance.now();
   batch.forEach(([a,b],i)=>{const j=arr[i];if(!j||!j.a)return;this.aiCool.set(a.name,now+180000);this.aiCool.set(b.name,now+180000);
    this.say(a,'✨ '+clip(j.a));setTimeout(()=>j.b&&this.say(b,'✨ '+clip(j.b)),1800);this.aiLines=(this.aiLines||0)+2;
    if(j.fact)this.spread(a,b,'✨ '+clip(j.fact));});this.hud();}catch{this.llm.fail++;this.hud();}}
 async headline(){const facts=this.facts.slice(0,8);if(!facts.length)return;
  const out=await this.chat([{role:'system',content:'You are Arjun, a cheerful local reporter. Write ONE catchy headline (max 14 words) summarising today\'s neighbourhood news. No quotes.'},{role:'user',content:facts.join('\n')}],60);
  this.env.addNews('🗞️ HEADLINE: '+(out?out.slice(0,140):`Busy day: ${facts.length} stories from the neighbourhood!`));}
}
