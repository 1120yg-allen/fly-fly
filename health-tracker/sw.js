// 離線快取：先回應快取，同時在背景更新
const CACHE = 'health-tracker-v3';
const ASSETS = ['./', 'index.html', 'styles.css', 'store.js', 'sync.js', 'meds.js', 'lab-catalog.js', 'labs.js', 'ocr.js', 'app.js', 'manifest.json', 'icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 同步 API 永遠走網路，不快取
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const network = fetch(e.request)
        .then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// 點擊服藥通知：「已服用」直接記錄，其他則打開服藥頁
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const doseId = e.notification.data?.doseId;
  const take = e.action === 'take' && doseId;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = all[0];
    if (client) {
      client.postMessage(take ? { type: 'take-dose', doseId } : { type: 'open-meds' });
      return client.focus();
    }
    const url = new URL(take ? `./?take=${encodeURIComponent(doseId)}#meds` : './#meds', self.registration.scope);
    return self.clients.openWindow(url.href);
  })());
});
