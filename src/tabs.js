// Two bottom tabs: Chat (talk to your agent) and World (the 3D map with its buttons and sheets).
// Only one of the map and the chat character renders at a time.
const $=id=>document.getElementById(id);
export function setupTabs({map,hero,onChat}){let cur=null;
  function set(t){if(t===cur)return;cur=t;const chat=t==='chat';document.body.dataset.tab=t;$('chatView').hidden=!chat;
    $('tabChat').setAttribute('aria-selected',chat);$('tabWorld').setAttribute('aria-selected',!chat);
    if(chat){hero.start();}else{hero.stop();map.resize();map.triggerRepaint();}}
  $('tabChat').onclick=()=>{if(onChat())set('chat');};$('tabWorld').onclick=()=>set('world');
  set('world');return {set,get current(){return cur;}};}
