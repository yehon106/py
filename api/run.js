// Cronoff code server proxy (made by yehon106).
// Only used for languages that cannot run inside the browser (Java, C#, Go, Rust, Kotlin).
// It forwards the code to a sandboxed runner that YOU connect with environment variables (see SETUP-SERVER.md).
//
// Environment variables (set in Vercel -> Project -> Settings -> Environment Variables):
//   RUNNER_URL      required   base URL of the runner, e.g. https://piston.example.com
//   RUNNER_TYPE     optional   "piston" (default) or "judge0"
//   RUNNER_KEY      optional   sent as the Authorization header (Piston) or X-Auth-Token (Judge0)
//   RUNNER_HEADERS  optional   extra headers as JSON, e.g. {"X-RapidAPI-Key":"...","X-RapidAPI-Host":"..."}
//   ACCESS_CODE     optional   if set, the site asks for this code before running server languages
//   JUDGE0_IDS      optional   JSON to override Judge0 language ids, e.g. {"java":62}

const LANGS = {
  java:   { piston: "java",   file: "Main.java", judge0: 62 },
  csharp: { piston: "csharp", file: "Main.cs",   judge0: 51 },
  go:     { piston: "go",     file: "main.go",   judge0: 60 },
  rust:   { piston: "rust",   file: "main.rs",   judge0: 73 },
  kotlin: { piston: "kotlin", file: "Main.kt",   judge0: 78 },
};
const MAX_CODE = 64 * 1024, MAX_STDIN = 16 * 1024, MAX_OUT = 64 * 1024;
const hits = new Map();   // ip -> recent request times (per server instance, best effort)

function limited(ip) {
  const now = Date.now(), list = (hits.get(ip) || []).filter((t) => now - t < 60000);
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > 12;   // 12 runs per minute per visitor
}
const clip = (s) => { s = String(s == null ? "" : s); return s.length > MAX_OUT ? s.slice(0, MAX_OUT) + "\n... output cut" : s; };
const send = (res, code, body) => { res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(body)); };

module.exports = async function handler(req, res) {
  if (req.method === "GET") return send(res, 200, { ready: !!process.env.RUNNER_URL });   // lets the site know whether to offer server languages
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  try {   // only this site may call it from a browser
    const o = req.headers.origin;
    if (o && new URL(o).host !== req.headers.host) return send(res, 403, { error: "Not allowed from this site." });
  } catch { return send(res, 403, { error: "Bad origin." }); }
  const base = (process.env.RUNNER_URL || "").replace(/\/+$/, "");
  if (!base) return send(res, 503, { error: "no-server", message: "No code server is connected yet. Add RUNNER_URL in Vercel (see SETUP-SERVER.md)." });
  if (process.env.ACCESS_CODE && req.headers["x-access-code"] !== process.env.ACCESS_CODE) return send(res, 401, { error: "access-code", message: "Wrong or missing access code." });
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim();
  if (limited(ip)) return send(res, 429, { error: "slow-down", message: "Too many runs. Wait a minute." });

  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = null; } }
  if (!b || typeof b !== "object") return send(res, 400, { error: "bad-request", message: "Bad request." });
  const L = LANGS[b.lang];
  const code = typeof b.code === "string" ? b.code : "", stdin = typeof b.stdin === "string" ? b.stdin : "";
  if (!L) return send(res, 400, { error: "bad-language", message: "This language is not available on the server." });
  if (!code.trim()) return send(res, 400, { error: "empty", message: "Nothing to run." });
  if (code.length > MAX_CODE || stdin.length > MAX_STDIN) return send(res, 413, { error: "too-big", message: "Code or input is too large." });

  const type = (process.env.RUNNER_TYPE || "piston").toLowerCase();
  const headers = { "Content-Type": "application/json" };
  try { Object.assign(headers, JSON.parse(process.env.RUNNER_HEADERS || "{}")); } catch {}
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 25000);
  try {
    let out;
    if (type === "judge0") {
      if (process.env.RUNNER_KEY) headers["X-Auth-Token"] = process.env.RUNNER_KEY;
      let ids = {}; try { ids = JSON.parse(process.env.JUDGE0_IDS || "{}"); } catch {}
      const r = await fetch(base + "/submissions?base64_encoded=false&wait=true", {
        method: "POST", headers, signal: ctl.signal,
        body: JSON.stringify({ language_id: ids[b.lang] || L.judge0, source_code: code, stdin, cpu_time_limit: 5, wall_time_limit: 10 }),
      });
      if (r.status === 429) return send(res, 429, { error: "daily-limit", message: "The free code server is out of runs for now (the free plan allows about 50 a day). Try again later." });
      if (r.status === 401 || r.status === 403) return send(res, 502, { error: "runner", message: "The code server refused the key. Check RUNNER_HEADERS in Vercel." });
      let j = await r.json().catch(() => ({}));
      if (!r.ok) return send(res, 502, { error: "runner", message: "The code server answered with an error (" + r.status + ")." + (j.error ? " " + j.error : "") });
      // some providers answer with just a ticket: ask for the result a few times
      for (let i = 0; i < 12 && j.token && !j.status; i++) {
        await new Promise((ok) => setTimeout(ok, 1000));
        const q = await fetch(base + "/submissions/" + j.token + "?base64_encoded=false", { headers, signal: ctl.signal });
        j = await q.json().catch(() => ({}));
      }
      for (let i = 0; i < 12 && j.status && (j.status.id === 1 || j.status.id === 2) && j.token; i++) {
        await new Promise((ok) => setTimeout(ok, 1000));
        const q = await fetch(base + "/submissions/" + j.token + "?base64_encoded=false", { headers, signal: ctl.signal });
        j = await q.json().catch(() => ({}));
      }
      const compileFail = j.status && j.status.id === 6;
      out = { stdout: clip(j.stdout), stderr: clip(compileFail ? j.compile_output : (j.stderr || "") + (j.compile_output && !j.stderr ? j.compile_output : "")), code: j.exit_code != null ? j.exit_code : (j.status && j.status.id === 3 ? 0 : 1), note: j.status && ![3, 4, 6, 11, 12].includes(j.status.id) ? j.status.description : "" };
    } else {
      if (process.env.RUNNER_KEY) headers["Authorization"] = process.env.RUNNER_KEY;
      const r = await fetch(base + "/api/v2/execute", {
        method: "POST", headers, signal: ctl.signal,
        body: JSON.stringify({ language: L.piston, version: "*", files: [{ name: L.file, content: code }], stdin, compile_timeout: 10000, run_timeout: 5000 }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return send(res, 502, { error: "runner", message: "The code server answered with an error (" + r.status + ")." + (j.message ? " " + j.message : "") });
      if (j.compile && j.compile.code !== 0) out = { stdout: clip(j.compile.stdout), stderr: clip(j.compile.stderr || j.compile.output), code: j.compile.code, note: "compile error" };
      else out = { stdout: clip(j.run && j.run.stdout), stderr: clip(j.run && j.run.stderr), code: j.run ? j.run.code : 1, note: j.run && j.run.signal ? "stopped: " + j.run.signal : "" };
    }
    return send(res, 200, out);
  } catch (e) {
    return send(res, 504, { error: "runner", message: e && e.name === "AbortError" ? "The code server took too long." : "Could not reach the code server." });
  } finally { clearTimeout(timer); }
};
