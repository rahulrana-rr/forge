/*
 * FORGE service worker: keeps the app shell available offline.
 *
 * The workout itself already lives on the device (localStorage + IndexedDB). Without this worker a
 * reload or a cold launch of the installed app with no signal shows the browser's offline page,
 * because nothing can serve the HTML and JS that read that data.
 *
 * - Pages (navigations): network first, cached copy when offline or slow. Cached by path; search
 *   params are read on the client, so /history?w=<id> is served from the /history page.
 * - /_next/static/*: cache first. Build files are content-hashed and never change.
 * - Exercise posters and app icons: stale-while-revalidate.
 * - /api/*, RSC payloads, videos and anything cross-origin go straight to the network. A failed
 *   RSC fetch makes Next fall back to a full navigation, which the page handler answers.
 *
 * Registered from components/app/service-worker-registrar.tsx (production builds only).
 * Bump VERSION when this file's caching rules change.
 */
const VERSION = "v1"
const PAGES_CACHE = `forge-pages-${VERSION}`
/** Hashed build files are shared across versions; trimmed oldest-first (see MAX_STATIC). */
const STATIC_CACHE = "forge-static"
const MEDIA_CACHE = "forge-media"
const KNOWN_CACHES = [PAGES_CACHE, STATIC_CACHE, MEDIA_CACHE]

/** Routes precached on install (and on "warm") together with every build file they reference. */
const SHELL = ["/", "/today", "/progress", "/history", "/profile", "/onboarding", "/sign-in"]
const OFFLINE_URL = "/offline.html"
const ICONS = ["/manifest.webmanifest", "/icon.svg", "/apple-icon.png", "/favicon.ico"]

/** With a cached copy in hand, a navigation waits this long for the network before using it. */
const NAVIGATION_TIMEOUT_MS = 3500
/** Next sends Vary on RSC headers; cached entries are keyed by URL alone. */
const MATCH = { ignoreVary: true }
const MAX_PAGES = 60
const MAX_STATIC = 600
const MAX_MEDIA = 200

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()))
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names.filter((name) => name.startsWith("forge-") && !KNOWN_CACHES.includes(name)).map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener("message", (event) => {
  // Sent by the registrar at most twice a day while online, so shell pages track new deploys.
  if (event.data && event.data.type === "warm") event.waitUntil(precacheShell())
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith("/api/")) return

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(event, url))
    return
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request))
    return
  }
  if (request.headers.has("range")) return
  if ((url.pathname.startsWith("/media/") && /\.(webp|png|jpe?g|svg)$/.test(url.pathname)) || ICONS.includes(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, request))
  }
})

/* ------------------------------------------------------------------ */
/* Navigations                                                         */
/* ------------------------------------------------------------------ */

async function handleNavigation(event, url) {
  // Old workout-detail URLs: the detail view now lives on the static /history page, which is
  // cached, so a "View history" tap after a workout with no signal still opens the workout.
  const detail = url.pathname.match(/^\/history\/([^/]+)\/?$/)
  if (detail) {
    return Response.redirect(`${self.location.origin}/history?w=${encodeURIComponent(safeDecode(detail[1]))}`, 302)
  }

  const key = url.pathname
  const cache = await caches.open(PAGES_CACHE)
  const cached = await cache.match(key, MATCH)
  const network = fetch(event.request).then((response) => {
    if (isCacheablePage(response)) event.waitUntil(storePage(cache, key, response.clone()))
    return response
  })
  // Keep the background refresh alive even when the cached copy wins the race.
  event.waitUntil(network.catch(() => undefined))

  try {
    return cached ? await raceWithTimeout(network, NAVIGATION_TIMEOUT_MS, cached) : await network
  } catch {
    return cached ?? (await caches.match(OFFLINE_URL, MATCH)) ?? Response.error()
  }
}

function raceWithTimeout(promise, ms, fallback) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function isCacheablePage(response) {
  return (
    response.ok &&
    response.type === "basic" &&
    !response.redirected &&
    (response.headers.get("content-type") || "").includes("text/html")
  )
}

async function storePage(cache, key, response) {
  const html = await response.clone().text()
  await cache.put(key, response)
  await Promise.all([cacheBuildFiles(html), trimCache(PAGES_CACHE, MAX_PAGES, [...SHELL, OFFLINE_URL])])
}

/** Fetches the shell pages and every build file they reference. One failure never blocks the rest. */
async function precacheShell() {
  const cache = await caches.open(PAGES_CACHE)
  await Promise.allSettled([
    ...SHELL.map(async (path) => {
      // "no-cache" revalidates with the ETag, so an unchanged page costs a 304.
      const response = await fetch(path, { cache: "no-cache", credentials: "same-origin" })
      if (isCacheablePage(response)) await storePage(cache, path, response)
    }),
    (async () => {
      const response = await fetch(OFFLINE_URL, { cache: "no-cache" })
      if (response.ok) await cache.put(OFFLINE_URL, response)
    })(),
  ])
}

/* ------------------------------------------------------------------ */
/* Build files and media                                               */
/* ------------------------------------------------------------------ */

const BUILD_FILE = /\/_next\/static\/[^"'\\\s)<>]+/g

async function cacheBuildFiles(html) {
  const urls = Array.from(new Set(html.match(BUILD_FILE) || []))
  if (!urls.length) return
  const cache = await caches.open(STATIC_CACHE)
  await Promise.allSettled(
    urls.map(async (path) => {
      if (await cache.match(path, MATCH)) return
      const response = await fetch(path)
      if (response.ok) await cache.put(path, response)
    }),
  )
  await trimCache(STATIC_CACHE, MAX_STATIC)
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE)
  const cached = await cache.match(request, MATCH)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok && response.type === "basic") await cache.put(request, response.clone())
  return response
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(MEDIA_CACHE)
  const cached = await cache.match(request, MATCH)
  const network = fetch(request).then(async (response) => {
    if (response.ok && response.type === "basic") {
      await cache.put(request, response.clone())
      await trimCache(MEDIA_CACHE, MAX_MEDIA)
    }
    return response
  })
  if (cached) {
    event.waitUntil(network.catch(() => undefined))
    return cached
  }
  return network
}

/** Deletes the oldest entries (insertion order) beyond `max`, never the paths in `keep`. */
async function trimCache(name, max, keep = []) {
  const cache = await caches.open(name)
  const keys = await cache.keys()
  let excess = keys.length - max
  for (const request of keys) {
    if (excess <= 0) break
    if (keep.includes(new URL(request.url).pathname)) continue
    await cache.delete(request)
    excess--
  }
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
