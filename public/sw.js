const CACHE = "presence-static-v3";
const SHELL = ["/manifest.webmanifest", "/icons/presence-192-v2.png", "/icons/presence-512-v2.png"];

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

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/app#calendar";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => "focus" in client);
      if (existing) {
        existing.navigate(target);
        return existing.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Presence", body: event.data?.text() || "You have a new update." };
  }
  const title = data.title || "Presence";
  const options = {
    body: data.body || "You have a new attendance update.",
    icon: data.icon || "/icons/presence-192-v2.png",
    badge: data.badge || "/icons/presence-192-v2.png",
    tag: data.tag || `presence-${data.kind || "update"}`,
    renotify: true,
    vibrate: [120, 60, 120],
    data: { url: data.url || "/app" },
    actions: [{ action: "open", title: "Open Presence" }],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
