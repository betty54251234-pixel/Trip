const OLD_CACHE_PREFIX='trippath-';
self.addEventListener('install',e=>{self.skipWaiting();});
self.addEventListener('activate',e=>{
  e.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith(OLD_CACHE_PREFIX)).map(k=>caches.delete(k)));
    await self.registration.unregister();
    const clients=await self.clients.matchAll({type:'window'});
    for(const c of clients){try{c.navigate(c.url)}catch(_){}}
  })());
});
