// Living World offline support: always try the newest version first, fall back to the saved copy when offline.
const CACHE='lw-cache-v1';
const CORE=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png'];
self.addEventListener('install',e=>{ self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).catch(()=>{})); });
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url); if(e.request.method!=='GET'||u.origin!==location.origin||u.pathname.endsWith('latest.json')) return;
  e.respondWith(fetch(e.request,{cache:'no-cache'}).then(r=>{ if(r.ok){ const cp=r.clone(); caches.open(CACHE).then(c=>c.put(e.request,cp)); } return r; })
    .catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match('./index.html'))));
});
