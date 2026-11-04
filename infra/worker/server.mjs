// HyperFrames Render Service (Tahap 1, 2026-11-02) - proses TERPISAH dari app utama
// (Node 24, port internal 3400). Terima komposisi HTML -> render ke MP4 via HyperFrames CLI
// (Chromium headless + ffmpeg) -> balikin MP4. TERISOLASI: app produksi (Node 20, :3200)
// tidak bergantung ke sini sampai di-wire opt-in (Tahap 4). Bind 127.0.0.1 saja + secret header.
import http from "node:http";
import { mkdtemp, cp, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir, cpus } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.HF_PORT || 3400);
const SECRET = process.env.HYPERFRAMES_RENDER_SECRET || "";
const BASE_DIR = path.join(__dirname, "base");
const HF = "hyperframes@0.8.230"; // pin versi (sama dgn yg diuji Tahap 0)
const RENDER_TIMEOUT_MS = 25 * 60 * 1000;

// Serialisasi render: 1 render sekali jalan (box 2-core/3.8GB - hindari 2 Chrome barengan).
let tail = Promise.resolve();
function serial(fn) {
  const prev = tail;
  let release;
  const gate = new Promise((r) => (release = r));
  tail = gate;
  return (async () => {
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  })();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function renderHtmlToMp4(html, meta) {
  const dir = await mkdtemp(path.join(tmpdir(), "hf_"));
  try {
    await cp(BASE_DIR, dir, { recursive: true });
    await writeFile(path.join(dir, "index.html"), html, "utf8");
    if (meta && typeof meta === "object") {
      await writeFile(path.join(dir, "meta.json"), JSON.stringify(meta), "utf8");
    }
    await execFileAsync("npx", ["--yes", HF, "render", "--workers", String(cpus().length), "--video-frame-format", "jpg", "--sdr"], {
      cwd: dir,
      timeout: RENDER_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
      env: process.env,
    });
    const rdir = path.join(dir, "renders");
    const files = (await readdir(rdir)).filter((f) => f.endsWith(".mp4")).sort();
    if (files.length === 0) throw new Error("render selesai tapi tak ada MP4 di renders/");
    return await readFile(path.join(rdir, files[files.length - 1]));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true, service: "hyperframes-render" }));
    }
    if (req.method === "POST" && req.url === "/render") {
      if (SECRET && req.headers["x-render-secret"] !== SECRET) {
        res.writeHead(401, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "unauthorized" }));
      }
      let body;
      try {
        body = JSON.parse((await readBody(req)).toString("utf8"));
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "body harus JSON {html, meta?}" }));
      }
      if (!body.html || typeof body.html !== "string") {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "field 'html' (string) wajib" }));
      }
      const mp4 = await serial(() => renderHtmlToMp4(body.html, body.meta));
      res.writeHead(200, { "content-type": "video/mp4", "content-length": mp4.length });
      return res.end(mp4);
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  } catch (e) {
    console.error("[hf-render] error:", e);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(e?.message || e) }));
  }
});

const BIND = process.env.HF_BIND || "127.0.0.1";
server.listen(PORT, BIND, () => console.log(`[hf-render] listening ${BIND}:${PORT}`));
