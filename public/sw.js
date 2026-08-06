// Minimal service worker: network-first for same-origin GETs, offline fallback
// to the app shell.
//
// v2 — why this changed:
// v1 cached EVERY same-origin GET, index.html included. Vite emits a new hashed
// bundle (index-<hash>.js) on every deploy and Vercel only serves the assets
// belonging to the current deployment, so an old index.html points at a file
// that no longer exists. One failed or slow fetch was enough to fall back to the
// cached shell, which then 404'd on its own script — a blank white page that
// survived reloads, because each reload was served the same stale shell.
//
// Two changes fix it:
//   1. Navigations are NEVER served from cache while online, and the cached copy
//      is only ever used as a genuine offline fallback.
//   2. Only hashed build assets under /assets/ are cached. They are immutable,
//      so a cached one can never be the wrong version of itself.
//
// The CACHE name is also bumped, which makes the activate handler below purge
// everything v1 stored — including any stale index.html already on a device.
const CACHE = 'oc-shell-v2'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

// Only immutable, content-hashed build output is worth caching.
const isHashedAsset = (url) => url.pathname.startsWith('/assets/')

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return // never touch Supabase / API / CDN

  // ---- navigations (the HTML shell) ----
  // Always go to the network. Cache a copy purely so there is something to show
  // if the device is genuinely offline; never prefer it while a network exists.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('/index.html', copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match('/index.html'))
    )
    return
  }

  // ---- hashed build assets ----
  if (isHashedAsset(url)) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          // Don't cache errors — a cached 404 is how you brick an app.
          if (res && res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
          }
          return res
        })
        .catch(() => caches.match(req))
    )
    return
  }

  // Everything else (icons, manifest, etc.) goes straight to the network.
})
