// Service worker: guarda la closca de l'app per obrir-la ràpid. Les dades sempre van a Google.
const CACHE = "xf-2";
const SHELL = ["./", "index.html", "shim.js?v=2", "manifest.webmanifest", "icon-192.png", "apple-touch-icon.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  // Primer la xarxa (per tenir sempre l'última versió), si no hi ha connexió, la còpia
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); if (r.ok) caches.open(CACHE).then(c => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: u.pathname.endsWith("/") || u.pathname.endsWith("index.html") })));
});
