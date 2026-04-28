// Gemmi Academy — service worker.
//
// Goals:
//   1. App shell loads from cache, even offline. (HTML, JS, CSS, KaTeX fonts.)
//   2. Lesson packs (/packs/*.json) are cached on first read and reused thereafter.
//   3. /api/tutor is NEVER cached — it always goes to network (or local model).
//   4. New deploys swap in cleanly without trapping the user on a stale shell.

const SHELL_CACHE = 'gemmi-shell-v3'
const RUNTIME_CACHE = 'gemmi-runtime-v3'

// Bare-minimum precache — Vite-hashed assets are picked up at runtime by
// match-on-fetch instead. We just need enough to render the root HTML offline.
const PRECACHE = [
  '/',
  '/index.html',
  '/icon.svg',
  '/manifest.webmanifest',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) =>
      Promise.all(
        PRECACHE.map((url) =>
          fetch(url, { cache: 'reload' })
            .then((res) => (res.ok ? c.put(url, res) : null))
            .catch(() => null),
        ),
      ),
    ),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k)),
      ),
    ),
  )
  self.clients.claim()
})

// Allow the page to ask the SW to warm the pack cache.
self.addEventListener('message', (event) => {
  const data = event.data || {}
  if (data.type === 'warm_cache' && Array.isArray(data.urls)) {
    event.waitUntil(
      caches.open(RUNTIME_CACHE).then(async (c) => {
        let cached = 0
        let failed = 0
        for (const u of data.urls) {
          try {
            const r = await fetch(u, { cache: 'reload' })
            if (r.ok) {
              await c.put(u, r.clone())
              cached++
            } else failed++
          } catch {
            failed++
          }
        }
        event.source?.postMessage({ type: 'warm_cache_done', cached, failed, total: data.urls.length })
      }),
    )
  }
  if (data.type === 'skip_waiting') self.skipWaiting()
})

function cacheable(url) {
  return (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/packs/') ||
    url.pathname === '/icon.svg' ||
    url.pathname === '/manifest.webmanifest' ||
    /\.(?:woff2?|ttf|otf|css|js)$/.test(url.pathname)
  )
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return // let cross-origin (fonts etc.) hit network
  if (url.pathname.startsWith('/api/')) return // never cache the tutor endpoint

  // HTML navigations: network-first so deploys land fast, fall back to cached shell.
  if (
    event.request.mode === 'navigate' ||
    (event.request.headers.get('accept') || '').includes('text/html')
  ) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone()
          caches.open(SHELL_CACHE).then((c) => c.put('/index.html', copy)).catch(() => {})
          return res
        })
        .catch(async () => {
          const cached = await caches.match('/index.html')
          return cached || new Response('Offline', { status: 503 })
        }),
    )
    return
  }

  // Static assets + packs + fonts: cache-first, revalidate in background.
  if (cacheable(url)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const network = fetch(event.request)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(RUNTIME_CACHE).then((c) => c.put(event.request, copy)).catch(() => {})
            }
            return res
          })
          .catch(() => cached || Response.error())
        return cached || network
      }),
    )
    return
  }

  // Everything else: try network, fall back to cache if available.
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)))
})
