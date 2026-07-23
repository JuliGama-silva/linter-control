/**
 * LINTER CONTROL — Service Worker
 * Estratégia: Cache-First para assets estáticos, Network-Only para API Supabase.
 * O app abre mesmo sem internet graças ao cache do shell.
 */

const CACHE_NAME = 'linter-control-v1';
const CACHE_VERSION = 1;

// Assets do app shell — cacheados na instalação
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// CDN assets — cacheados dinamicamente na primeira carga
const CDN_CACHE = 'linter-cdn-v1';

/* ─── INSTALL: cache do app shell ─────────────────────────────── */
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando — cacheando app shell...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => {
        console.log('[SW] App shell cacheado com sucesso.');
        return self.skipWaiting(); // Ativa imediatamente sem aguardar reload
      })
      .catch(err => console.warn('[SW] Erro ao cachear shell:', err))
  );
});

/* ─── ACTIVATE: limpa caches antigos ──────────────────────────── */
self.addEventListener('activate', (event) => {
  console.log('[SW] Ativando e limpando caches antigos...');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== CDN_CACHE)
          .map(k => { console.log('[SW] Removendo cache antigo:', k); return caches.delete(k); })
      )
    ).then(() => self.clients.claim())
  );
});

/* ─── FETCH: estratégia por tipo de request ───────────────────── */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Supabase API — sempre via rede, nunca cacheado
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          JSON.stringify({ data: null, error: { message: 'Sem conexão com o servidor.' } }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // 2. CDN (jsdelivr, cdnjs) — cache dinâmico, stale-while-revalidate
  if (url.hostname.includes('jsdelivr.net') || url.hostname.includes('cdnjs.cloudflare.com')) {
    event.respondWith(
      caches.open(CDN_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          const fetched = fetch(event.request).then(response => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          }).catch(() => cached); // Se falhar, usa cache
          return cached || fetched;
        })
      )
    );
    return;
  }

  // 3. App shell e assets locais — Cache First
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request)
        .then(response => {
          if (response.ok && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline e não está no cache — retorna index.html (SPA fallback)
          if (event.request.destination === 'document') {
            return caches.match('/index.html');
          }
          return new Response('Recurso não disponível offline.', { status: 503 });
        });
    })
  );
});

/* ─── MESSAGE: comunicação com o app ─────────────────────────── */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    console.log('[SW] Forçando ativação imediata...');
    self.skipWaiting();
  }
  if (event.data === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_VERSION, cache: CACHE_NAME });
  }
});
