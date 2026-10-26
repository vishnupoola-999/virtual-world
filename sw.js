// App-shell service worker: network-first for our own files (so new deploys show up), cache fallback when offline.
// Pinned CDN files (three.js, MapLibre: URLs carry an exact @x.y.z version, so they never change) are cache-first in their
// own cache, which survives shell version bumps. Nothing else cross-origin (Firebase, the chat proxy, tiles, APIs) is touched.
const C='vw-shell-v45',CDN='vw-cdn-v1';
const PINNED=/^https:\/\/(cdn\.jsdelivr\.net|unpkg\.com)\/npm\/[^/]+@\d+\.\d+\.\d+\/|^https:\/\/unpkg\.com\/[^/]+@\d+\.\d+\.\d+\//;
const WARM=['https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js'];
const SHELL=['./','index.html','join.html','manifest.json','favicon.svg','src/style.css','src/ui-v2.css','src/world-v2.css','src/living.css','src/ui-v3.css','src/feed.css','src/town.js','src/names.js','src/living.js','src/away.js','src/interests.js','src/world-agents.js','src/agent-renderer.js','fonts/inter-latin-wght-400-600.woff2','src/main.js','src/map.js','src/ui.js','src/agent.js','src/firebase.js','src/family.js','src/family-layer.js','src/flights.js','src/chat.js','src/google-tools.js','src/calendarWhen.js','src/ui/confirmAction.js','src/tools-config.js','src/agentTools.js','src/chat-hero.js','src/tabs.js','src/character.js','src/onboarding.js','src/device.js','src/character-data.js','src/ambient.js','src/cards3d.js','src/chat-hero-3d.js','assets/map-style-night.json','icons/icon-192.png'];
self.addEventListener('install',e=>{// The CDN warm-up is best effort: a CDN hiccup must never fail the install.
  e.waitUntil(caches.open(C).then(c=>c.addAll(SHELL)).then(()=>caches.open(CDN)).then(c=>Promise.all(WARM.map(u=>c.match(u).then(h=>h||fetch(new Request(u,{mode:'cors',credentials:'omit'})).then(r=>r.ok&&store(c,u,r)).catch(()=>{})))))
    .then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C&&k!==CDN).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
// Cache-first for pinned CDN files. Always fetched as CORS without credentials (the page tags carry crossorigin="anonymous"),
// so stored copies are normal readable responses, never opaque ones. Only ok responses are stored. Storing pkg@X drops the
// same package at any other version, so upgrades don't pile up.
const pkgOf=u=>(u.match(/^https:\/\/[^/]+\/(?:npm\/)?([^/]+)@\d+\.\d+\.\d+\//)||[])[1];
function store(c,url,r){const pkg=pkgOf(url);
  return c.keys().then(ks=>Promise.all(ks.filter(k=>k.url!==url&&pkg&&pkgOf(k.url)===pkg&&!k.url.includes(pkg+'@'+url.split(pkg+'@')[1].split('/')[0]+'/')).map(k=>c.delete(k))))
    .then(()=>c.put(url,r)).catch(()=>{});}
function cdn(req){return caches.open(CDN).then(c=>c.match(req.url).then(hit=>hit||fetch(new Request(req.url,{mode:'cors',credentials:'omit'})).then(r=>{if(r.ok&&r.type==='cors')store(c,req.url,r.clone());return r;})));}
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET')return;
  if(u.origin!==location.origin){if(PINNED.test(e.request.url))e.respondWith(cdn(e.request));return;}
  e.respondWith(fetch(e.request).then(r=>{if(r.ok){const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));}return r;})
    .catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match('index.html'))));});
