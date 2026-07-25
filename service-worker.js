// =========================================================
// Service Worker — bikin app bisa di-"install" ke homescreen HP
// + cache tampilan (shell) supaya buka app tetap cepat walau
// sinyal di lapangan lemah. Data tetap butuh koneksi (via Supabase),
// ini cuma men-cache HTML/CSS/JS-nya, bukan data produksi.
// =========================================================
const CACHE_NAME = "produksi-downtime-shell-v1";

const SHELL_FILES = [
  "/login.html",
  "/index.html",
  "/assets/style.css",
  "/assets/supabaseClient.js",
  "/assets/machine-page.js",
  "/machines/tandem.html",
  "/machines/blanking.html",
  "/machines/transfer-2000t.html",
  "/machines/transfer-800t.html",
  "/machines/pc200t.html",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // pakai addAll dengan catch supaya 1 file gagal tidak gagalkan semua
      Promise.allSettled(SHELL_FILES.map((f) => cache.add(f)))
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Strategi: network-first untuk HTML (supaya selalu dapat versi terbaru kalau
// online), fallback ke cache kalau offline. Untuk request ke Supabase
// (data produksi/downtime) TIDAK di-cache — harus selalu langsung ke server.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Jangan campur tangan request ke Supabase / domain lain
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
