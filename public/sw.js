const CACHE = "presence-static-v2";
const SHELL = ["/manifest.webmanifest", "/icons/icon-192.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  const isStaticAsset = url.pathname.startsWith("/_next/static/")
    || url.pathname.startsWith("/icons/")
    || url.pathname === "/manifest.webmanifest";

  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
        if (response.ok && response.type === "basic") {
          caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
        }
        return response;
      })),
    );
    return;
  }

  // Never cache authenticated page HTML or an old build's chunk references.
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => new Response(
      "You are offline. Reconnect to sign in or mark attendance.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    )));
  }
});
