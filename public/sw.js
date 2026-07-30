/**
 * Trackside service worker.
 *
 * Its only job is making the app open at a marshal post with no signal. The
 * outbox handles writes; this handles the shell those writes are typed into,
 * because a queue you cannot reach because the page will not load is no use.
 *
 * Deliberately conservative about what it caches:
 *
 *   - Navigations fall back to a cached copy only when the network fails, so
 *     nobody is ever shown a stale page while online.
 *   - API and auth requests are never cached. A cached timing board or a
 *     cached Clerk response would be actively dangerous: an official would be
 *     looking at a grid that has moved on, or a session that has expired.
 *   - Static build assets are cached on first use, since Next.js fingerprints
 *     them and a fingerprinted file never changes.
 */

const CACHE = "raceops-shell-v1";

/** Requests that must always go to the network, offline or not. */
function isNeverCached(url) {
  return (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/__clerk") ||
    url.pathname.startsWith("/sign-in") ||
    url.pathname.startsWith("/sign-up")
  );
}

self.addEventListener("install", (event) => {
  // Take over as soon as the new worker is ready rather than waiting for
  // every tab to close — a marshal will not close their tab all weekend.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isNeverCached(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put(request, response.clone());
          return response;
        } catch {
          // Offline: this page if we have it, otherwise anything at all, so
          // the app opens and the outbox is reachable.
          const cached = await caches.match(request);
          if (cached) return cached;
          const fallback = await caches.match("/events");
          if (fallback) return fallback;
          return new Response(
            "<h1>Offline</h1><p>RaceOps has not been opened on this device while online yet.</p>",
            { status: 503, headers: { "Content-Type": "text/html" } },
          );
        }
      })(),
    );
    return;
  }

  // Fingerprinted build assets: serve from cache, fill it on first use.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone());
        return response;
      })(),
    );
  }
});
