'use strict';
const CACHE='__CACHE_NAME__';
const ASSETS=__ASSETS__;
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('nourish-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  // Only cache this app's static shell. Auth and private data always bypass this cache.
  if(request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(new URL(self.registration.scope).pathname))return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then(response=>{
      if(!response.ok)throw Error('Page unavailable');
      const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put('./index.html',copy)));return response;
    }).catch(()=>caches.open(CACHE).then(cache=>cache.match('./index.html'))));return;
  }
  if(!/\.(js|css|png|svg)$/.test(url.pathname)||url.pathname.endsWith('/sw.js'))return;
  event.respondWith(caches.open(CACHE).then(async cache=>{
    const cached=await cache.match(request);if(cached&&url.searchParams.has('v'))return cached;
    try{const response=await fetch(request);if(response.ok)await cache.put(request,response.clone());return response;}
    catch(error){if(cached)return cached;throw error;}
  }));
});
