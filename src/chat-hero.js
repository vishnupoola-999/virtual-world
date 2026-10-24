// Chat-tab character header. Thin wrapper: the three.js view (chat-hero-3d.js) is lazy-loaded the first time it is needed,
// so three.js is not on the startup path (perf audit #2). Calls made before it loads are replayed.
export function chatHero(canvas){let real=null,loading=null,agent=null,active=false,st=null;
  const load=()=>loading||=import('./chat-hero-3d.js').then(m=>{real=m.chatHero(canvas);if(agent)real.set(agent);if(st)real.state(st);if(active)real.start();return real;})
    .catch(e=>{loading=null;console.warn('chat hero',e?.message);});
  return {
    set(a){agent=a;if(real)real.set(a);else if(a&&active)load();},
    start(){active=true;if(real)real.start();else if(agent)load();},
    stop(){active=false;real?.stop();},
    state(s){st=s;real?.state(s);}};}
