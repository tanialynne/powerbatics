// Powerbatics service worker.
// Bump CACHE when shipping changes you want to force-refresh.
const CACHE = "pb-v2-5";
const SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./parser.mjs",
  "./styles.css",
  "./manifest.webmanifest",
  "./program.json",
  "./custom.json",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

// Let the page ask us to activate immediately when a new version is ready.
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

// Strategy:
// - Navigations + program.json: network-first (so updates appear fast when online)
// - Everything else same-origin: cache-first, fall back to network, store for next time
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // Never intercept proxy calls — always hit the network fresh.
  if (url.pathname.startsWith("/api/")) return;

  const isProgram = url.pathname.endsWith("/program.json");
  const isNav = req.mode === "navigate";

  if (isProgram || isNav) {
    e.respondWith(
      fetch(req)
        .then((r) => {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return r;
        })
        .catch(() => caches.match(req).then((m) => m || caches.match("./index.html"))),
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req)
          .then((r) => {
            const copy = r.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            return r;
          })
          .catch(() => hit),
    ),
  );
});
