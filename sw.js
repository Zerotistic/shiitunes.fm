/* Service worker: instant shell for returning visitors and a working app
 * shell offline. Audio never lives here, playback is YouTube embeds and
 * simply requires being online.
 *
 * Caching contract (mirrors the ?v= convention in index.html):
 *  - URLs carrying a ?v= stamp are immutable-by-convention → cache-first.
 *    Deploys bump the stamp, which is a new URL, which is a cache miss.
 *  - Fonts are content-stable → cache-first.
 *  - Everything else same-origin (index.html, the unstamped js modules, the
 *    chibi svg) → network-first with cache fallback, so a deploy is picked
 *    up on the next load and the site still opens with no connection.
 *  - Cross-origin (YouTube, thumbnails) is never touched.
 *
 * Deploy rule: this ASSETS list carries the same ?v= stamps as index.html —
 * the "bump every ?v= stamp" ritual (and publish-tracks.sh for the
 * tracks.json ?v=) must include this file. The cache name is derived from
 * the stamps, so old caches retire automatically. */

const ASSETS = [
  "./",
  "./index.html",
  "./css/base.css?v=56",
  "./css/views.css?v=56",
  "./css/about.css?v=56",
  "./css/player.css?v=56",
  "./css/overlays.css?v=56",
  "./css/responsive.css?v=56",
  "./css/bee.css?v=56",
  "./js/app.js?v=56",
  "./js/bindings.js",
  "./js/collections.js",
  "./js/components.js",
  "./js/data.js",
  "./js/dialogs.js",
  "./js/menu.js",
  "./js/playback.js",
  "./js/player.js",
  "./js/playlists.js",
  "./js/queue.js",
  "./js/render.js",
  "./js/router.js",
  "./js/state.js",
  "./js/toast.js",
  "./js/utils.js",
  "./js/views.js",
  "./data/tracks.json?v=21",
  "./fonts/quicksand-latin.woff2",
  "./fonts/baloo2-latin.woff2",
  "./assets/chibi-concert.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./manifest.webmanifest"
];

const CACHE = "shiitunes-" + ASSETS
  .map((url) => (url.match(/\?v=(\d+)/) || [])[1])
  .filter(Boolean)
  .join(".");

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

/* Network-first: fresh wins, cache saves offline. Successful responses are
 * re-cached so unstamped files stay current for the next offline visit. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error("offline and uncached");
  }
}

/* Navigations all resolve to the one document. Caching them per visited URL
 * would grow one stored index.html copy for every ?pl=/?t= link ever opened —
 * store and serve under the single canonical key instead. */
async function navigationFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put("./index.html", response.clone());
    return response;
  } catch {
    const cached = await cache.match("./index.html");
    if (cached) return cached;
    throw new Error("offline and uncached");
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(navigationFirst(request));
    return;
  }
  if (url.search.includes("v=") || url.pathname.includes("/fonts/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(networkFirst(request));
});
