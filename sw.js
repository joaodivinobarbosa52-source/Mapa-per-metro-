/* Service Worker — GPS off
   - App (HTML, libs, ícones): pré-cache na instalação, abre instantâneo offline.
   - Tiles de mapa/satélite: cache separado e persistente (não é apagado ao atualizar o app). */
const VERSAO = 'v10';
const CACHE_APP = 'grade-solo-app-' + VERSAO;
const CACHE_TILES = 'grade-solo-tiles';   // mesmo nome usado no index.html
const MAX_TILES = 4000;

const ARQUIVOS_APP = [
  './',
  './index.html',
  './manifest.json'
];

const HOSTS_TILES = ['tile.openstreetmap.org', 'server.arcgisonline.com'];
const PNG_VAZIO = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
), c => c.charCodeAt(0));

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_APP).then(async c => {
    // cada arquivo é guardado isoladamente: se um faltar, os outros continuam valendo
    await Promise.all(ARQUIVOS_APP.map(u => c.add(u).catch(() => {})));
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const chaves = await caches.keys();
    await Promise.all(chaves
      .filter(k => k.startsWith('grade-solo-app-') && k !== CACHE_APP)
      .map(k => caches.delete(k)));
    // limpa o cache antigo (versões anteriores guardavam tudo em 'grade-solo-v3')
    await caches.delete('grade-solo-v3');
    await self.clients.claim();
  })());
});

async function limitarCache(nome, max){
  const cache = await caches.open(nome);
  const chaves = await cache.keys();
  if (chaves.length > max){
    await Promise.all(chaves.slice(0, chaves.length - max).map(k => cache.delete(k)));
  }
}

async function tile(request){
  const cache = await caches.open(CACHE_TILES);
  const guardado = await cache.match(request, {ignoreVary: true});
  if (guardado) return guardado;
  try {
    const resp = await fetch(request);
    if (resp && (resp.ok || resp.type === 'opaque')){
      cache.put(request, resp.clone());
      if (Math.random() < 0.02) limitarCache(CACHE_TILES, MAX_TILES);
    }
    return resp;
  } catch (err){
    // offline e sem tile salvo: devolve quadrado transparente (sem ícone de imagem quebrada)
    return new Response(PNG_VAZIO, {headers: {'Content-Type': 'image/png'}});
  }
}

async function appStaleWhileRevalidate(request){
  const cache = await caches.open(CACHE_APP);
  const guardado = await cache.match(request, {ignoreSearch: true});
  const atualiza = fetch(request).then(resp => {
    if (resp && resp.ok) cache.put(request, resp.clone());
    return resp;
  }).catch(() => null);
  if (guardado){ return guardado; }
  const resp = await atualiza;
  return resp || new Response('Sem conexão.', {status: 503});
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (HOSTS_TILES.includes(url.hostname)){
    event.respondWith(tile(req));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate'){
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_APP);
      const guardado = await cache.match('./index.html');
      // atualiza em segundo plano; a nova versão aparece na próxima abertura
      const atualiza = fetch(req).then(resp => {
        if (resp && resp.ok) cache.put('./index.html', resp.clone());
        return resp;
      }).catch(() => null);
      return guardado || (await atualiza) || new Response('Sem conexão.', {status: 503});
    })());
    return;
  }
  event.respondWith(appStaleWhileRevalidate(req));
});
