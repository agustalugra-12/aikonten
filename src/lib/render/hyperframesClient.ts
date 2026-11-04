// Client ke worker render HyperFrames (Opsi C, 2026-11-02). POST komposisi HTML -> MP4 Buffer.
// URL via tunnel (hf-tunnel.service): default http://127.0.0.1:3400. Secret header.
// Deadline total sisi-klien (2026-11-03): worker bisa HANG -> deadline 28min (> RENDER_TIMEOUT_MS worker
// 25min) -> abort + reject -> fallback ffmpeg di processProject. Timer selalu dibersihkan.
//
// Gerbang 2 (2026-11-04, feat/worker-queue): antrean app-side di BELAKANG flag HYPERFRAMES_QUEUE_ENABLED.
// FLAG OFF (default) -> jalur lama postRender apa adanya (IDENTIK produksi). FLAG ON -> fair-queue per tenant
// (antre adil, bukan langsung fallback) + idempotency (anti render ganda) + slot-timeout + retry transient.
import http from "node:http";
import { FairScheduler, InFlightRegistry, makeJobId, runWithSlotTimeout, nextRetryDelayMs, isRetriable, isQueueTimeout, isQueueFull } from "./workerQueue";

const renderUrl = () => process.env.HYPERFRAMES_RENDER_URL || "http://127.0.0.1:3400"; // call-time (env bisa di-set belakangan/tes)
const SECRET = process.env.HYPERFRAMES_RENDER_SECRET || "";
const RENDER_DEADLINE_MS = Number(process.env.HYPERFRAMES_RENDER_DEADLINE_MS) || 28 * 60 * 1000;
// Timeout render worker (server.mjs RENDER_TIMEOUT_MS). Deadline client WAJIB > ini supaya worker SEHAT
// sempat balas 500 duluan, dan (selama /cancel belum ada) slot tak dianggap bebas sebelum timeout worker lewat.
const WORKER_RENDER_TIMEOUT_MS = Number(process.env.HYPERFRAMES_WORKER_TIMEOUT_MS) || 25 * 60 * 1000;
const RETRY_CFG = { maxAttempts: 2, baseMs: 1500, capMs: 8000 };
// DASAR ANGKA (2026-11-04): HyperFrames hanya me-render video <=210s (HYPERFRAMES_MAX_SECONDS di
// processProject; di atas itu ffmpeg langsung). Jalur SDR ~4.8fps -> 210s@30fps = 6300 frame / 4.8 =~ 22 menit
// (mendekati cap worker 25min); video ~60s =~ 6 menit. Jadi render TIPIKAL ~6 menit, WORST ~22-25 menit.
export const TYPICAL_RENDER_MS = 6 * 60 * 1000;   // referensi tes "dua render 6 menit tidak fallback"
// Default queue-timeout = cap worker 25min: satu job boleh menunggu selama ~satu render WORST-CASE di
// depannya (lebih dari itu, job di depan sendiri sudah kena timeout worker -> slot bebas). 5min lama terlalu
// agresif (jatuh ke ffmpeg walau antrean normal). Batas antrean (QUEUE_MAX) yg mencegah tunggu tanpa batas.
export const QUEUE_TIMEOUT_DEFAULT_MS = 25 * 60 * 1000;
// Batas job MENUNGGU: ~queueTimeout/tipikal (25/6 =~ 4) + margin. Penuh -> tolak cepat (fallback), tak numpuk.
export const QUEUE_MAX_DEFAULT = 8;
// Dibaca saat CALL (bukan module-load) -> testable toggle; prod set via systemd env.
const queueEnabled = () => process.env.HYPERFRAMES_QUEUE_ENABLED === "1" || process.env.HYPERFRAMES_QUEUE_ENABLED === "true";
const queueTimeoutMs = () => Number(process.env.HYPERFRAMES_QUEUE_TIMEOUT_MS) || QUEUE_TIMEOUT_DEFAULT_MS;
const queueMax = () => Number(process.env.HYPERFRAMES_QUEUE_MAX) || QUEUE_MAX_DEFAULT;

// Singleton per-proses: render SATU per satu (serial, cocok worker) + registry in-flight (dedup).
const scheduler = new FairScheduler(Number(process.env.HYPERFRAMES_MAX_CONCURRENT) || 1);
const inFlight = new InFlightRegistry<Buffer>();

type QueueLog = (step: string, action: string, result: string) => void;
export type RenderQueueOpts = { tenantId: string; projectId: string; contentHash: string; log?: QueueLog };

// POST mentah ke worker (jalur lama, dipakai flag-off & di dalam antrean). Tag error deadline __renderTimeout
// supaya renderWithRetry TIDAK me-retry timeout render (mahal, cenderung berulang).
function postRender(html: string, meta: { id?: string; name?: string } | undefined, opts: { deadlineMs: number; url?: string; signal?: AbortSignal }): Promise<Buffer> {
  const deadlineMs = opts.deadlineMs;
  const u = new URL(opts.url || renderUrl());
  const payload = JSON.stringify({ html, meta: meta || { id: "app", name: "app" } });
  return new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (err: Error | null, buf?: Buffer) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
      if (err) reject(err); else resolve(buf as Buffer);
    };
    const req = http.request(
      {
        host: u.hostname,
        port: Number(u.port || 80),
        path: "/render",
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload), "x-render-secret": SECRET },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (d: Buffer) => chunks.push(d));
        res.on("error", (e) => done(e));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const ct = String(res.headers["content-type"] || "");
          if (res.statusCode === 200 && ct.includes("video")) done(null, buf);
          else done(new Error(`HyperFrames render gagal (${res.statusCode}): ${buf.toString("utf8").slice(0, 300)}`));
        });
      }
    );
    req.on("error", (e) => done(e));
    function onAbort() { done(new Error("render dibatalkan (abort)")); req.destroy(); }
    if (opts.signal) { if (opts.signal.aborted) { onAbort(); return; } opts.signal.addEventListener("abort", onAbort); }
    timer = setTimeout(() => {
      done(Object.assign(new Error(`HyperFrames render timeout sisi-klien ${Math.round(deadlineMs / 1000)}s (worker tak merespons) - fallback ffmpeg`), { __renderTimeout: true }));
      req.destroy();
    }, deadlineMs);
    req.write(payload);
    req.end();
  });
}

// Render + retry transient (502/ECONNRESET/tunnel). Timeout render TIDAK di-retry (req6). Habis -> throw (fallback).
async function renderWithRetry(signal: AbortSignal, deadlineMs: number, url: string | undefined, html: string, meta: { id?: string; name?: string } | undefined, log?: QueueLog): Promise<Buffer> {
  let attempt = 0;
  for (;;) {
    try {
      return await postRender(html, meta, { deadlineMs, url, signal });
    } catch (e) {
      if ((e as { __renderTimeout?: boolean })?.__renderTimeout) { log?.("render_queue", "timeout render -> TIDAK di-retry", "no_retry"); throw e; }
      if (!isRetriable("error", e)) throw e;
      const delay = nextRetryDelayMs(attempt, RETRY_CFG);
      if (delay === null) { log?.("render_queue", `retry habis (${attempt}x) -> fallback`, "retry_exhausted"); throw e; }
      log?.("render_queue", `transient: ${String((e as Error)?.message || e).slice(0, 80)} -> retry#${attempt} +${delay}ms`, "retry");
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}

export async function renderComposition(
  html: string,
  meta?: { id?: string; name?: string },
  opts?: { deadlineMs?: number; url?: string }, // override utk tes (deadline pendek / server tiruan)
  queueOpts?: RenderQueueOpts,                    // Gerbang 2: aktif hanya kalau flag ON + param ini ada
): Promise<Buffer> {
  // FLAG OFF atau tanpa queueOpts -> jalur lama (IDENTIK produksi).
  if (!queueEnabled() || !queueOpts) {
    return postRender(html, meta, { deadlineMs: opts?.deadlineMs ?? RENDER_DEADLINE_MS, url: opts?.url });
  }
  const { tenantId, projectId, contentHash, log } = queueOpts;
  // Deadline render: PRODUKSI (opts.deadlineMs tak di-set) WAJIB > timeout worker 25min (req3) -> worker
  // sehat sempat balas + slot tak dianggap bebas sebelum timeout worker lewat (req6, selama /cancel belum ada).
  // opts.deadlineMs = override UJI (deadline pendek) -> bypass floor; produksi tak pernah set.
  const renderDeadlineMs = opts?.deadlineMs ?? Math.max(RENDER_DEADLINE_MS, WORKER_RENDER_TIMEOUT_MS + 60 * 1000);
  const jobId = makeJobId(tenantId, projectId, contentHash);
  const res = inFlight.run(jobId, () => scheduleAndRender(tenantId, renderDeadlineMs, opts?.url, html, meta, log));
  if (res.deduped) log?.("render_queue", `job ${jobId} sudah in-flight -> pakai hasil sama`, "dedup");
  return res.promise;
}

async function scheduleAndRender(tenantId: string, renderDeadlineMs: number, url: string | undefined, html: string, meta: { id?: string; name?: string } | undefined, log?: QueueLog): Promise<Buffer> {
  try {
    return await scheduler.schedule(
      tenantId,
      async () => {
        const t0 = Date.now();
        // runWithSlotTimeout: TANPA onTimeout (/cancel belum ada) -> slot ditahan sampai worker balas atau
        // renderDeadlineMs (>25min worker) lewat -> tak ada render kedua menimpa worker yg masih sibuk (req6).
        // Batas slot = renderDeadlineMs + grace supaya deadline postRender (__renderTimeout) menang DULUAN
        // secara bersih (hindari race abort ganda); slot-timeout murni jaring pengaman terakhir.
        const slot = await runWithSlotTimeout<Buffer>(
          (signal) => renderWithRetry(signal, renderDeadlineMs, url, html, meta, log),
          renderDeadlineMs + 2000,
        );
        log?.("render_queue", `render ${Date.now() - t0}ms`, slot.ok ? "ok" : slot.reason);
        if (slot.ok) return slot.value;
        throw slot.error;
      },
      { queueTimeoutMs: queueTimeoutMs(), maxWaiting: queueMax(), onDequeue: (waitedMs) => log?.("render_queue", `antre ${waitedMs}ms`, "dequeued") },
    );
  } catch (e) {
    if (isQueueFull(e)) log?.("render_queue", `antrean penuh (>= ${queueMax()}) -> fallback ffmpeg`, "queue_full");
    else if (isQueueTimeout(e)) log?.("render_queue", `antre > ${queueTimeoutMs()}ms -> fallback ffmpeg`, "queue_timeout");
    else log?.("render_queue", `gagal: ${String((e as Error)?.message || e).slice(0, 120)} -> fallback ffmpeg`, "fallback");
    throw e; // -> renderViaHyperframes catch -> processProject fallback ffmpeg (perilaku aman existing)
  }
}
