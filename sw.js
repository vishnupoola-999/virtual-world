// App-shell service worker: network-first for our own files (so new deploys show up), cache fallback when offline.
const C='vw-shell-v8';
const SHELL=['./','index.html','join.html','manifest.json','favicon.svg','src/style.css','src/main.js','src/map.js','src/ui.js','src/agent.js','src/avatar3d.js','src/firebase.js','src/family.js','src/family-layer.js','src/flights.js','src/chat.js','src/chat-hero.js','src/tabs.js','src/character.js','src/onboarding.js','src/device.js','src/character-data.js','src/cards3d.js','src/chat-hero-3d.js','assets/map-style-night.json','icons/icon-192.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;
  e.respondWith(fetch(e.request).then(r=>{if(r.ok){const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));}return r;})
    .catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match('index.html'))));});
