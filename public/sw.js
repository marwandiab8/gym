/*
 * K2 Tracker service worker: opens the installed app instantly from local storage and keeps the shell working offline.
 *
 * It only ever answers requests for the app's own files and a few pinned library files. Firestore, Firebase Auth,
 * Cloud Functions and every other Google API go straight to the network, so workout data is never served stale.
 *
 * BUILD_ID and PRECACHE are stamped by scripts/build-assets.mjs on every deploy (firebase.json hosting.predeploy).
 * The stamp changes whenever any shipped file changes, which is what makes browsers install the new version.
 */

// BEGIN STAMP
const BUILD_ID = "b8d4eadc4f1a";
const PRECACHE = [
  "/app.js",
  "/apple-touch-icon.png",
  "/favicon-32.png",
  "/icon-192.png",
  "/icon-512.png",
  "/index.html",
  "/js/setScoring.js",
  "/js/workoutSession.js",
  "/k2_logo.png",
  "/progress.html",
  "/prs.html",
  "/rest-timer-finished.wav",
  "/settings.html",
  "/site.webmanifest",
  "/styles.css",
  "/tailwind.css"
];
// END STAMP

const SHELL_CACHE = `k2-shell-${BUILD_ID}`;
const RUNTIME_CACHE = "k2-runtime-v1";

// Pinned third-party files. Versioned URLs never change, so they are served cache-first.
const PINNED_EXTERNAL = [
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js",
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js",
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-solid-900.woff2",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-regular-400.woff2",
];
// Unversioned: served from cache but refreshed in the background.
const FLOATING_EXTERNAL = ["https://cdn.jsdelivr.net/npm/chart.js"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    // Same-origin shell is all-or-nothing, and bypasses the HTTP cache, so a build is never half installed or stale.
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" })));
    // Third-party files are best effort: a CDN hiccup must not block installing the app itself.
    const runtime = await caches.open(RUNTIME_CACHE);
    await Promise.allSettled([...PINNED_EXTERNAL, ...FLOATING_EXTERNAL].map(async (url) => {
      if (await runtime.match(url)) return;
      const response = await fetch(url, { mode: "cors" });
      if (response.ok) await runtime.put(url, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("k2-shell-") && key !== SHELL_CACHE) await caches.delete(key);
    }
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Writes, and byte-range requests (audio), are never ours to answer.
  if (request.method !== "GET" || request.headers.has("range")) return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname === "/sw.js") return;
    event.respondWith(fromShell(request, url));
    return;
  }
  if (PINNED_EXTERNAL.includes(url.href)) {
    event.respondWith(fromRuntimeCacheFirst(request));
    return;
  }
  if (FLOATING_EXTERNAL.includes(url.href)) {
    event.respondWith(fromRuntimeStaleWhileRevalidate(event, request));
  }
  // Anything else (Firestore, Auth, Cloud Functions, other Google APIs) is deliberately not handled.
});

async function fromShell(request, url) {
  const cache = await caches.open(SHELL_CACHE);
  // "/" is the home page; the ?v= cache-buster on app.js is irrelevant because the whole build is versioned.
  const path = url.pathname === "/" ? "/index.html" : url.pathname;
  const hit = await cache.match(path);
  if (hit) return hit;
  return fetch(request);
}

async function fromRuntimeCacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request.url, response.clone());
  return response;
}

async function fromRuntimeStaleWhileRevalidate(event, request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const hit = await cache.match(request.url);
  const refresh = fetch(request)
    .then(async (response) => {
      if (response.ok) await cache.put(request.url, response.clone());
      return response;
    })
    .catch(() => null);
  event.waitUntil(refresh);
  return hit || (await refresh) || Response.error();
}
