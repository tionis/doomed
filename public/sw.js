const cacheName = "promptly-doomed-v1";
const scopeUrl = self.registration.scope;
const assetUrl = (path) => new URL(path, scopeUrl).toString();
const coreAssets = [
  scopeUrl,
  assetUrl("manifest.webmanifest"),
  assetUrl("favicon.svg"),
  assetUrl("logo.svg"),
  assetUrl("icons/icon-192.png"),
  assetUrl("icons/icon-512.png"),
  assetUrl("icons/maskable-512.png"),
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(cacheName)
      .then((cache) => cache.addAll(coreAssets))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(cacheName).then((cache) => cache.put(scopeUrl, copy));
          return response;
        })
        .catch(() => caches.match(scopeUrl)),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(cacheName).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
