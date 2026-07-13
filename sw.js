/* Yield Vector — service worker
   (Path B; run 2026-07-08-module-split-efficiency step 3 P3 — shell)

   Minimal, dependency-free, network-first with a Cache-Storage fallback.
   Contract: docs/assessments/2026-07-08-module-split-design.md §1 (Path B)
   + run 2026-07-08-module-split-efficiency §5(d).

   Behaviour:
   • Precache = app shell (index.html) + all 19 versioned ES-module URLs, in a
     cache NAMED by APP_VERSION. `activate` deletes every other-versioned cache.
   • Same-origin GET → network-first: always try the network first (preserves
     the app's always-fresh behaviour — the whole reason the single-file design
     avoided a SW), and fall back to Cache Storage only when the network fails
     (offline). Successful responses refresh the cache opportunistically, so a
     lazily-fetched same-origin asset (e.g. dd-methods.json) becomes available
     offline after its first online fetch.
   • PASSTHROUGH — never intercepted, never cached: any cross-origin request
     (Gist sync at api.github.com, the DoC-import Cloudflare Worker) and any
     non-GET. A stale cached cloud state is exactly the "erroneous deletion"
     fear made real, so cloud calls must always hit the live network.

   STEP-5 COUPLING: APP_VERSION below is a literal. Bump it together with the
   <head> import-map `?v=` literals and js/runtime-status.js APP_VERSION.
*/
'use strict';

const APP_VERSION = '2026.07.11c';
const CACHE_PREFIX = 'yv-precache-';
const CACHE_NAME = CACHE_PREFIX + APP_VERSION;

/* The 19 split modules — kept in lockstep with the <head> import map. */
const MODULES = [
  'app-state', 'date-format-core', 'dd-core', 'dd-widgets', 'doc-import-templates',
  'doc-parser', 'events-actions-data', 'migrations-catalogs', 'modals-forms',
  'offer-model', 'optimizer-engine', 'projection-optimizer', 'reminders', 'render-main-views',
  'render-shell-overview', 'requirements-templates', 'runtime-status',
  'sync-pwa', 'ui-utils'
];

/* App shell + every versioned module URL. Module URLs carry the same
   ?v=APP_VERSION query the import map requests, so cache keys match exactly. */
const PRECACHE_URLS = ['./', './index.html'].concat(
  MODULES.map(function (m) { return './js/' + m + '.js?v=' + APP_VERSION; })
);

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(PRECACHE_URLS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (names) {
        return Promise.all(names.map(function (name) {
          // CacheStorage is origin-scoped and cmr2334.github.io serves ALL of
          // the owner's project pages, so only evict THIS app's own stale
          // precaches (yv-precache-* other than the current version); leave
          // every other origin key (unrelated / future apps) untouched.
          return (name !== CACHE_NAME && name.indexOf(CACHE_PREFIX) === 0)
            ? caches.delete(name) : null;
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  var url = new URL(req.url);
  // PASSTHROUGH (early-return, no respondWith): cross-origin, api.github.com
  // (Gist — never cache cloud state), and any non-GET always hit the network.
  if (url.origin !== self.location.origin) return;
  if (url.hostname === 'api.github.com') return; // redundant w/ cross-origin; explicit per contract §5d
  if (req.method !== 'GET') return;
  event.respondWith(networkFirst(req));
});

function networkFirst(req) {
  return caches.open(CACHE_NAME).then(function (cache) {
    return fetch(req).then(function (res) {
      if (res && res.ok) cache.put(req, res.clone()); // refresh cache when online
      return res;
    }).catch(function (err) {
      return cache.match(req).then(function (cached) {
        if (cached) return cached;
        if (req.mode === 'navigate') {
          return cache.match('./').then(function (root) {
            return root || cache.match('./index.html');
          }).then(function (shell) {
            if (shell) return shell;
            throw err;
          });
        }
        throw err;
      });
    });
  });
}
