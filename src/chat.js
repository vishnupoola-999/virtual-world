// Simple chat with the user's agent through the Gemini proxy. History stays on this device for now (memory comes in Phase 3).
import {toast} from './ui.js';
const API='https://virtual-world-ai.onrender.com/chat';
const $=id=>document.getElementById(id);
export function setupChat(getAgent,getUser){
  const key=()=>'vw-chat-'+(getUser()?.uid||'guest');let hist=[];
  const add=(role,text,cls='')=>{const d=document.createElement('div');d.className=`msg ${role==='user'?'me':'ag'} ${cls}`;d.textContent=text;$('chatLog').append(d);$('chatLog').scrollTop=1e9;return d;};
  const save=()=>localStorage.setItem(key(),JSON.stringify(hist.slice(-40)));
  function open(){const a=getAgent();if(!getUser()){toast('Sign in first to chat with your agent');return;}if(!a){toast('Create your agent first (🤖 button)');return;}
    $('chatTitle').textContent=`${a.look?.emoji||'🤖'} ${a.name}`;$('chatSub').textContent='';
    try{hist=JSON.parse(localStorage.getItem(key())||'[]');}catch{hist=[];}
    $('chatLog').innerHTML='';if(!hist.length)hist.push({role:'assistant',content:`Hi ${(getUser().displayName||'').split(' ')[0]||'there'}! I'm ${a.name}. What can I help you with today?`});
    for(const m of hist)add(m.role,m.content);$('chat').hidden=false;setTimeout(()=>$('chatIn').focus(),50);}
  $('chatBtn').onclick=open;$('chatBack').onclick=()=>$('chat').hidden=true;
  $('chatF').onsubmit=async e=>{e.preventDefault();const t=$('chatIn').value.trim();if(!t)return;$('chatIn').value='';
    const a=getAgent();hist.push({role:'user',content:t});add('user',t);save();const w=add('assistant','…','typing');
    const sys=`You are ${a.name}, the personal AI agent of ${getUser()?.displayName||'your owner'}, living in Virtual World, a 3D map of the real world. Personality: ${a.personality||'friendly and helpful'}. Reply briefly and warmly, like a chat message.`;
    try{const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'system',content:sys},...hist.slice(-8)],max_tokens:250})});
      if(r.status===429)throw new Error('I\'m getting a lot of messages, try again in a minute.');
      const j=await r.json();const txt=j.choices?.[0]?.message?.content?.trim();if(!r.ok||!txt)throw new Error('I couldn\'t think of a reply just now, please try again.');
      w.remove();hist.push({role:'assistant',content:txt});add('assistant',txt);save();}
    catch(err){w.remove();add('assistant','⚠️ '+(err.message||'Network error'));}};}
