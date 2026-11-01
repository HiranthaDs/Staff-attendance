const VERSION = "v4";
const STATIC_CACHE = `presence-static-${VERSION}`;
const OFFLINE_URL = "/offline";
const PRECACHE = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/presence-192-v2.png",
  "/icons/presence-512-v2.png",
  "/icons/presence-maskable-512-v2.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter((key) => key.startsWith("presence-") && key !== STATIC_CACHE).map((key) => caches.delete(key)));
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "CLEAR_CACHES") {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("presence-")).map((key) => caches.delete(key)))));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return (await event.preloadResponse) || await fetch(request);
      } catch {
        return (await caches.match(OFFLINE_URL)) || new Response("Presence is offline.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
    })());
    return;
  }

  const cacheableAsset = url.pathname.startsWith("/_next/static/")
    || url.pathname.startsWith("/icons/")
    || url.pathname === "/manifest.webmanifest";
  if (!cacheableAsset) return;
  event.respondWith((async () => {
    const cached = await caches.match(request);
    const update = fetch(request).then(async (response) => {
      if (response.ok && (response.type === "basic" || response.type === "cors")) {
        await (await caches.open(STATIC_CACHE)).put(request, response.clone());
      }
      return response;
    }).catch(() => cached);
    return cached || update;
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;
  const target = new URL(event.notification.data?.url || "/app", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
    const existing = clients.find((client) => client.url.startsWith(self.location.origin) && "focus" in client);
    if (existing) {
      await existing.navigate(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  }));
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { title: "Presence", body: event.data?.text() || "You have a new update." }; }
  event.waitUntil(self.registration.showNotification(data.title || "Presence", {
    body: data.body || "You have a new attendance update.",
    icon: data.icon || "/icons/presence-192-v2.png",
    badge: data.badge || "/icons/presence-192-v2.png",
    tag: data.tag || `presence-${data.kind || "update"}`,
    renotify: true,
    requireInteraction: data.kind === "attendance",
    vibrate: [120, 60, 120],
    timestamp: Date.now(),
    data: { url: data.url || "/app" },
    actions: [{ action: "open", title: "Open Presence" }, { action: "dismiss", title: "Dismiss" }],
  }));
});
