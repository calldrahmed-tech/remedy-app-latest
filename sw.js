// sw.js — Service Worker for offline/weak-connection resilience.
//
// Problem this solves: right now, if repertory.json or remedies.json fail to
// load (weak signal, no connection), the app shows an error and stops —
// completely unusable even though the doctor already has it open. A
// Cloud Function / Firebase auth call failing is fine to surface as an error
// (those need a live connection by nature), but the CORE feature — typing
// symptoms and getting a remedy — needs zero network once the page has been
// visited at least once.
//
// Strategy: network-first with a short timeout, not cache-first. This matters
// because repertory.json changes frequently as bugs get fixed — a doctor with
// a working connection must ALWAYS get the latest file, never a stale cached
// one. The cache is purely a last-resort fallback for when the network is
// truly unavailable or too slow to matter, not a way to skip fetching.
//
// Scope: only intercepts same-origin GET requests for the app's own static
// files. Firebase auth/Firestore/Functions calls go to a different origin
// (gstatic.com, firebaseapp.com, cloudfunctions.net) and are never touched —
// login/save-visit/AI-assist correctly still require a real connection.

const CACHE_NAME = "expertia-cache-v6";
const NETWORK_TIMEOUT_MS = 4000; // a "weak" connection gets this long before
                                  // falling back to cache — long enough for a
                                  // slow response, short enough not to feel frozen

// Precached on install so the app works completely offline immediately after
// the very first visit, not just after the doctor has happened to load every
// page once.
const PRECACHE_FILES = [
  "./",
  "index.html",
  "style.css",
  "script.js",
  "protocol-mode.js",
  "ai-assist.js",
  "auth-ui.js",
  "patient-info.js",
  "hering-analysis.js",
  "patient-records.js",
  "browse-repertory.js",
  "repertorize.js",
  "repertory.json",
  "remedies.json",
  "manifest.json",
  "privacy.html",
  "icon-192.png",
  "icon-header.png",
  "icon-512.png",
  "apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // Add files one by one so a single missing file can't make the whole
      // install fail (cache.addAll is all-or-nothing).
      .then((cache) => Promise.all(PRECACHE_FILES.map((f) =>
        cache.add(f).catch((err) => console.warn("SW precache skipped", f, err))
      )))
      .then(() => self.skipWaiting()) // activate the new SW immediately rather than
                                        // waiting for every open tab to close first —
                                        // this app's own files changing is exactly the
                                        // case this cache exists to stay current with
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

function timeoutPromise(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only ever intercept same-origin GET requests — everything else (Firebase
  // auth/Firestore/Functions, Google Fonts, any cross-origin call) passes
  // through completely untouched, exactly like there were no service worker.
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    Promise.race([fetch(req), timeoutPromise(NETWORK_TIMEOUT_MS)])
      .then((networkResponse) => {
        // Network succeeded (within the timeout window) — this is the normal,
        // preferred path. Update the cache in the background so the fallback
        // stays reasonably fresh for next time, without slowing this response.
        // Only successful responses are cached, so a 404/500 can never replace
        // a good cached copy.
        if (networkResponse && networkResponse.ok) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return networkResponse;
      })
      .catch(() =>
        // Network failed or was too slow — fall back to whatever we have
        // cached. If nothing is cached, return a real 503 response instead of
        // undefined (which would throw inside respondWith).
        caches.match(req).then((cached) =>
          cached || new Response("Offline and not cached yet.", { status: 503, statusText: "Offline" })
        )
      )
  );
});
