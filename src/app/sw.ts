/// <reference lib="webworker" />
/**
 * Service worker (US-7-01, ADR-018), compiled by @serwist/next into public/sw.js at build time.
 *
 * What it caches (and what it never caches):
 * - Precache: the build's static assets (`/_next/static/**`), public icons and the static
 *   `/offline` workspace page. Revisions come from the build, so each release replaces the previous
 *   precache and removes outdated entries.
 * - Runtime: same-origin static scripts/styles (cache first) and images/fonts (stale while revalidate).
 * - NEVER: page HTML or React Server Component payloads of signed-in pages, `/api/**` responses
 *   (commands, snapshots, reference data). Navigations go to the network; when the network fails,
 *   the precached `/offline` page answers. Reference data lives in IndexedDB, where sign-out deletes it.
 */
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { CacheFirst, ExpirationPlugin, NetworkOnly, Serwist, StaleWhileRevalidate } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

/** Bump when the caching scheme changes (cache names carry it; old runtime caches are removed on activate). */
const CACHE_VERSION = "v1";
const RUNTIME_CACHES = [`bc-static-${CACHE_VERSION}`, `bc-media-${CACHE_VERSION}`];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: { cleanupOutdatedCaches: true },
  cacheId: "bryels-care",
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  disableDevLogs: true,
  runtimeCaching: [
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({ cacheName: RUNTIME_CACHES[0], plugins: [new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 60 * 24 * 3600 })] }),
    },
    {
      matcher: ({ request, url, sameOrigin }) => sameOrigin && !url.pathname.startsWith("/api/") && (request.destination === "image" || request.destination === "font"),
      handler: new StaleWhileRevalidate({ cacheName: RUNTIME_CACHES[1], plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 30 * 24 * 3600 })] }),
    },
    // Pages, RSC payloads and the API: network only, never stored.
    { matcher: ({ request }) => request.mode === "navigate", handler: new NetworkOnly() },
    { matcher: () => true, handler: new NetworkOnly() },
  ],
  fallbacks: {
    entries: [{ url: "/offline", matcher: ({ request }) => request.destination === "document" }],
  },
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((n) => n.startsWith("bc-") && !RUNTIME_CACHES.includes(n)).map((n) => caches.delete(n)))),
  );
});

serwist.addEventListeners();
