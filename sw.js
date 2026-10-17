// Auto Radar: cache para abrir rápido/offline e notificações de oportunidades (enviadas pelo server.py do PC).
const CACHE = 'autoradar-v9';
const ASSETS = ['./', 'index.html', 'styles.css', 'app.js', 'config.js', 'sync.js',
  'icon.svg', 'icon-192.png', 'badge-96.png', 'manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('autoradar-') && k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// Rede primeiro (pega atualizações), cache como reserva offline. A API do server.py nunca vai para o cache.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  const atualizado = e.request.mode === 'navigate'
    ? fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
    : fetch(e.request, { cache: 'no-cache' });
  e.respondWith(
    atualizado
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match(e.request, { ignoreSearch: true })))
  );
});

// Push: { title, body, tag, image?, anuncio? } — anuncio traz { fonte, id, url, ... } para abrir na hora
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  const a = d.anuncio;
  const site = a && a.fonte === 'webmotors' ? 'Webmotors' : 'OLX';
  const actions = a ? [
    { action: 'anuncio', title: `🔗 Abrir na ${site}` },
    { action: 'app', title: '📱 Ver no app' },
  ] : [];
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || 'Auto Radar', {
      body: d.body || 'Novidade no radar.',
      tag: d.tag || 'autoradar',
      renotify: true,
      requireInteraction: Boolean(a),
      vibrate: [200, 100, 200, 100, 300],
      icon: 'icon-192.png',
      badge: 'badge-96.png',
      image: d.image || undefined,
      actions,
      data: { anuncio: a || null },
    });
    // App aberto: atualiza a lista na hora
    const abertos = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    abertos.forEach((c) => c.postMessage({ tipo: 'push', anuncio: a || null }));
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const a = e.notification.data?.anuncio;
  const escopo = self.registration.scope;
  let destino = escopo;
  if (a) {
    const detalhe = `${escopo}#/anuncio/${a.fonte}/${encodeURIComponent(a.id)}`;
    // Toque na notificação ou "Ver no app": abre o detalhe (com FIPE, sinais...); o botão abre o site do anúncio
    destino = e.action === 'anuncio' && a.url ? a.url : detalhe;
  }
  e.waitUntil((async () => {
    if (destino.startsWith(escopo)) {
      const abertos = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const app = abertos.find((c) => c.url.startsWith(escopo));
      if (app) {
        app.postMessage({ tipo: 'abrir', url: destino });
        return app.focus();
      }
    }
    return self.clients.openWindow(destino);
  })());
});
