/* Cronoff service worker: offline support + COOP/COEP headers (needed for SharedArrayBuffer) */
const APP_CACHE = "cronoff-app-v1";
const PYO_VERSION = "0.26.4";
// Cache name kept as-is so existing visitors do not re-download Pyodide.
const PYO_CACHE = "pyro-pyodide-" + PYO_VERSION;
const LIB_CACHE = "cronoff-libs-v1";
const CDN_ORIGIN = "https://cdn.jsdelivr.net";
const PYO_PATH = "/pyodide/v" + PYO_VERSION + "/full/";
const PYO_BASE = CDN_ORIGIN + PYO_PATH;

// Other languages. Keep these versions in sync with SQL_BASE / LUA_BASE in index.html.
// Ruby (ruby+stdlib.wasm, about 30 MB) is not pre-cached: it is saved the first time Ruby is used.
const LIB_PATHS = ["/npm/sql.js@1.14.2/dist/", "/npm/wasmoon@1.16.0/dist/", "/npm/@ruby/3.4-wasm-wasi@2.8.1/dist/"];
const LIBS = [
  CDN_ORIGIN + "/npm/sql.js@1.14.2/dist/sql-wasm.js",
  CDN_ORIGIN + "/npm/sql.js@1.14.2/dist/sql-wasm.wasm",
  CDN_ORIGIN + "/npm/wasmoon@1.16.0/dist/index.js",
  CDN_ORIGIN + "/npm/wasmoon@1.16.0/dist/glue.wasm",
  CDN_ORIGIN + "/npm/@ruby/3.4-wasm-wasi@2.8.1/dist/browser.umd.js",
];

const CORE = [
  "pyodide.js",
  "pyodide.asm.js",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
].map((f) => PYO_BASE + f);

const OPTIONAL = ["/index.html", "/manifest.json", "/jscpp.js", "/icon-192.png", "/icon-512.png"];

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
      // SQL, Lua and Ruby loader files: a failure here must not block the install; they are also saved when first used.
      const lib = await caches.open(LIB_CACHE);
      await Promise.allSettled(
        LIBS.map(async (u) => {
          if (await lib.match(u)) return;
          const r = await fetch(u, { mode: "cors", credentials: "omit" });
          if (!r.ok) throw new Error("Library precache failed: " + u + " " + r.status);
          await lib.put(u, r);
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
        if (k !== APP_CACHE && k !== PYO_CACHE && k !== LIB_CACHE) await caches.delete(k);
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

// CDN files (Pyodide + packages like numpy, sql.js, wasmoon): cache first, save anything new that gets fetched.
async function cdnCacheFirst(cacheName, req) {
  const cache = await caches.open(cacheName);
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
    e.respondWith(cdnCacheFirst(PYO_CACHE, req));
  } else if (url.origin === CDN_ORIGIN && LIB_PATHS.some((p) => url.pathname.startsWith(p))) {
    e.respondWith(cdnCacheFirst(LIB_CACHE, req));
  }
});
