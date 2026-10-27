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

// ============================================================
// Push notifications.
// These handlers were accidentally dropped on 2026-08-03 when this file was
// replaced with a caching-only version. Without a 'push' handler the browser
// receives every push but has nothing to show, so Chrome displays its own
// generic notice at most once and silently swallows the rest ("only one ding").
//
// Payload from the send-push edge function:
//   { title, body, url, tag, notification_id }   (tag = the notification's id)
// ============================================================
// Ask open Command Center windows to play the person's chosen sound.
// Resolves true if any window confirms it played (or the sound is turned off).
function askPagesToPlay(wins, id, type) {
  if (!wins.length) return Promise.resolve(false)
  return new Promise((resolve) => {
    let pending = wins.length, done = false
    const finish = (v) => { if (!done) { done = true; resolve(v) } }
    setTimeout(() => finish(false), 1500)
    for (const w of wins) {
      const ch = new MessageChannel()
      ch.port1.onmessage = (e) => {
        if (e.data && e.data.played) finish(true)
        else if (--pending === 0) finish(false)
      }
      try { w.postMessage({ kind: 'cc-push-sound', id, type }, [ch.port2]) } catch { if (--pending === 0) finish(false) }
    }
  })
}

// iPhone/iPad: pages can't play sounds on their own, and iOS expects every push to show a
// visible notification (it may switch push off for apps that don't). So on iOS we always
// show it, with the phone's own sound. (2026-10-27)
const IS_IOS = /iPhone|iPad|iPod/.test((self.navigator && self.navigator.userAgent) || '')

self.addEventListener('push', (event) => {
  let p = {}
  try { p = event.data ? event.data.json() : {} } catch { p = { body: event.data ? event.data.text() : '' } }

  const title = p.title || 'Command Center'
  const url = p.url || p.link || '/'
  const id = p.notification_id || p.tag || String(Date.now())
  const type = p.type || null

  event.waitUntil((async () => {
    const wins = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .filter(w => new URL(w.url).origin === self.location.origin)

    // 1) Command Center open and in front of you → sound only, no pop-up (computers only).
    if (!IS_IOS && wins.some(w => w.visibilityState === 'visible' && w.focused)) {
      await askPagesToPlay(wins, id, type)
      return
    }

    // 2) Open in the background → the app plays YOUR sound and the pop-up stays
    //    quiet. 3) Closed (or the tab can't play audio) → the pop-up uses the
    //    computer's notification sound so it's never silent.
    const played = IS_IOS ? false : await askPagesToPlay(wins, id, type)
    await self.registration.showNotification(title, {
      body: p.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: id,             // unique per notification → each one shows
      renotify: false,
      silent: played,
      data: { url, notificationId: p.notification_id || null },
    })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const w of wins) {
      if (new URL(w.url).origin !== self.location.origin) continue
      try { if ('navigate' in w) await w.navigate(target) } catch { /* fall through to focus */ }
      return w.focus()
    }
    return self.clients.openWindow(target)
  })())
})

self.addEventListener('pushsubscriptionchange', () => {
  // The browser rotated the subscription; the app re-registers it on its next load.
  console.warn('Push subscription changed; the app will re-register it.')
})
