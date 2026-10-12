/* Pyro service worker: offline support + COOP/COEP headers (needed for SharedArrayBuffer) */
const APP_CACHE = "pyro-app-v1";
const PYO_VERSION = "0.26.4";
const PYO_CACHE = "pyro-pyodide-" + PYO_VERSION;
const CDN_ORIGIN = "https://cdn.jsdelivr.net";
const PYO_PATH = "/pyodide/v" + PYO_VERSION + "/full/";
const PYO_BASE = CDN_ORIGIN + PYO_PATH;

const CORE = [
  "pyodide.js",
  "pyodide.asm.js",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
].map((f) => PYO_BASE + f);

const OPTIONAL = ["/index.html", "/manifest.json", "/icon-192.png", "/icon-512.png"];

// Re-wrap a response with the headers that keep the page cross-origin isolated.
function isolate(res) {
  if (!res || res.status === 0) return res; // opaque / opaqueredirect: cannot be rewrapped
  const h = new Headers(res.headers);
  h.delete("content-encoding");
  h.delete("content-length");
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set("Cross-Origin-Embedder-Policy", "require-corp");
  h.set("Cross-Origin-Resource-Policy", "cross-origin");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    (async () => {
      const pyo = await caches.open(PYO_CACHE);
      await Promise.all(
        CORE.map(async (u) => {
          if (await pyo.match(u)) return;
          const r = await fetch(u, { mode: "cors", credentials: "omit" });
          if (!r.ok) throw new Error("Pyodide precache failed: " + u + " " + r.status);
          await pyo.put(u, r);
        })
      );
      const app = await caches.open(APP_CACHE);
      await app.add(new Request("/", { cache: "reload" }));
      await Promise.allSettled(OPTIONAL.map((u) => app.add(new Request(u, { cache: "reload" }))));
    })()
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) {
        if (k !== APP_CACHE && k !== PYO_CACHE) await caches.delete(k);
      }
      await self.clients.claim();
    })()
  );
});

// Own files: network first (so GitHub updates show up), cache when offline.
async function networkFirst(req) {
  const cache = await caches.open(APP_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return isolate(res);
  } catch (err) {
    const hit =
      (await cache.match(req, { ignoreSearch: true })) ||
      (req.mode === "navigate" ? await cache.match("/") : undefined);
    if (hit) return isolate(hit);
    return new Response("Offline and not cached yet.", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

// Pyodide files and packages (numpy etc.): cache first, save anything new that gets fetched.
async function pyodideCacheFirst(req) {
  const cache = await caches.open(PYO_CACHE);
  const hit = await cache.match(req.url);
  if (hit) return isolate(hit);
  const res = await fetch(req.url, { mode: "cors", credentials: "omit" });
  if (res.ok) cache.put(req.url, res.clone());
  return isolate(res);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname === "/sw.js" || url.pathname.startsWith("/_vercel")) return;
    e.respondWith(networkFirst(req));
  } else if (url.origin === CDN_ORIGIN && url.pathname.startsWith(PYO_PATH)) {
    e.respondWith(pyodideCacheFirst(req));
  }
});
