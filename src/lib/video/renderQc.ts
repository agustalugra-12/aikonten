// QC render HyperFrames (Tahap 8). Tiga lapis:
//  1. staticPreCheck(html): deterministik, tanpa browser, selalu murah -> struktur, media, durasi, target animasi.
//  2. runHfGate(dir): `hyperframes check` (lint+runtime+layout+kontras) + `snapshot` di headless Chrome; HANYA
//     bila flag HF_PRERENDER_CHECK=1 (default OFF) karena memakai Chrome di mesin app.
//  3. decideQc(...): keputusan render / retry / fallback / reject + alasan, dari hasil di atas, error render,
//     dan statistik frame (scripts/hf-frame-review.ts).
// Plus summarizeRenderMetrics: durasi render, antre, gagal, fallback, retry, biaya per video dari autoFixLog.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type QcIssue = { level: "error" | "warn"; code: string; detail: string };
const num = (s: string | undefined) => (s === undefined ? NaN : Number(s));

export function staticPreCheck(html: string, opts: { allowedMediaHosts?: string[]; maxVideos?: number } = {}): QcIssue[] {
  const out: QcIssue[] = [];
  const add = (level: QcIssue["level"], code: string, detail: string) => out.push({ level, code, detail });
  const root = /<div id="root" data-composition-id="([^"]+)" data-start="0" data-duration="([\d.]+)"/.exec(html);
  const total = root ? num(root[2]) : NaN;
  if (!root) add("error", "no_root", "root composition tak ditemukan");
  else if (!(total > 0 && total <= 300)) add("error", "bad_duration", `durasi ${root[2]}`);
  if (!/window\.__timelines\[\s*"main"\s*\]\s*=\s*tl/.test(html)) add("error", "no_timeline", "timeline main tak didaftarkan");
  for (const m of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) if (!m[1].startsWith("./vendor/")) add("error", "external_script", m[1]);
  if (/<link[^>]+href=/i.test(html)) add("error", "external_link", "tag <link> dilarang (tanpa CDN)");
  for (const m of html.matchAll(/url\(\s*["']?([^"')]+)/g)) if (!m[1].startsWith("./fonts/")) add("error", "external_url", m[1]);
  // Media: http(s) di host yang diizinkan atau path relatif. data:/blob: ditolak (HyperFrames menolak base64).
  const hosts = opts.allowedMediaHosts;
  for (const m of html.matchAll(/<(video|audio)\b([^>]*)>/g)) {
    const attrs = m[2];
    const src = /\ssrc="([^"]*)"/.exec(attrs)?.[1] ?? "";
    const id = /\sid="([^"]+)"/.exec(attrs)?.[1] ?? "?";
    if (!src) add("error", "media_no_src", id);
    else if (/^(data|blob):/i.test(src)) add("error", "media_inline", id);
    else if (/^https?:\/\//.test(src) && hosts && !hosts.some((h) => new URL(src).host === h)) add("error", "media_host", `${id} ${new URL(src).host}`);
    const st = num(/data-start="([^"]+)"/.exec(attrs)?.[1]);
    if (!(st >= 0)) add("error", "media_no_start", id);
    if (m[1] === "video") {
      const du = num(/data-duration="([^"]+)"/.exec(attrs)?.[1]);
      if (!(du > 0)) add("error", "media_no_duration", id);
      else if (st + du > total + 0.05) add("error", "media_past_end", `${id} ${(st + du).toFixed(2)}>${total}`);
      if (!(num(/data-media-start="([^"]+)"/.exec(attrs)?.[1]) >= 0)) add("error", "media_bad_offset", id);
    } else if (st >= total) add("warn", "audio_after_end", id);
  }
  const videos = (html.match(/<video\b/g) || []).length;
  if (videos > (opts.maxVideos ?? 18)) add("error", "too_many_videos", String(videos));
  else if (videos > 12) add("warn", "many_videos", `${videos} <video> -> render lebih lambat`);
  // ID unik & target animasi ada (target hilang = animasi diam-diam tak tampil).
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const seen = new Set<string>();
  for (const id of ids) { if (seen.has(id)) add("error", "duplicate_id", id); seen.add(id); }
  const script = html.slice(html.lastIndexOf("<script>"));
  for (const m of script.matchAll(/tl\.(?:to|from|fromTo|set)\("#([A-Za-z0-9_-]+)/g)) if (!seen.has(m[1])) add("error", "missing_target", m[1]);
  return out;
}

export type HfGateResult = { ran: boolean; ok: boolean; errors: number; warnings: number; findings: string[]; snapshotDir?: string; ms: number };
export const hfGateEnabled = (env: Record<string, string | undefined> = process.env) => env.HF_PRERENDER_CHECK === "1";

// `hyperframes check --json` + `snapshot` pada direktori proyek (index.html + vendor + fonts). Butuh Node ≥ 22:
// HF_CLI_NODE_BIN = dir bin node 22+ (mis. ~/.nvm/versions/node/v24.x/bin). Error eksekusi -> ok=false (fail-closed).
export async function runHfGate(dir: string, opts: { env?: Record<string, string | undefined>; snapshotAt?: number[]; timeoutMs?: number; exec?: typeof execFile } = {}): Promise<HfGateResult> {
  const env = opts.env ?? process.env;
  const t0 = Date.now();
  if (!hfGateEnabled(env)) return { ran: false, ok: true, errors: 0, warnings: 0, findings: [], ms: 0 };
  const run = promisify(opts.exec ?? execFile);
  const PATH = env.HF_CLI_NODE_BIN ? `${env.HF_CLI_NODE_BIN}:${env.PATH ?? ""}` : env.PATH;
  const cli = ["--yes", "hyperframes@0.8.230"];
  const o = { env: { ...env, PATH, DO_NOT_TRACK: "1" } as unknown as NodeJS.ProcessEnv, timeout: opts.timeoutMs ?? 180_000, maxBuffer: 16 << 20 };
  try {
    let stdout = "";
    try { ({ stdout } = await run("npx", [...cli, "check", "--json", "--samples=7", dir], o)); }
    catch (e) { stdout = String((e as { stdout?: string }).stdout ?? ""); if (!stdout) throw e; } // exit≠0 = ada temuan
    // Format 0.8.230: { ok, browserSkipped, lint:{findings}, runtime:{findings}, layout:{findings}, motion, contrast, craft, audio }.
    const j = JSON.parse(stdout.slice(stdout.indexOf("{"))) as Record<string, unknown> & { ok?: boolean; browserSkipped?: boolean };
    type F = { severity?: string; code?: string; message?: string; section: string };
    const issues: F[] = [];
    for (const [section, v] of Object.entries(j)) {
      const fs = (v as { findings?: unknown })?.findings;
      if (Array.isArray(fs)) for (const f of fs as F[]) issues.push({ ...f, section });
    }
    const sev = (x: F) => (x.severity ?? "").toLowerCase();
    const errors = issues.filter((x) => sev(x) === "error").length;
    const warnings = issues.filter((x) => sev(x).startsWith("warn")).length;
    const findings = issues.filter((x) => sev(x) !== "info").slice(0, 20).map((x) => `${sev(x)}:${x.section}/${x.code ?? "?"}:${String(x.message ?? "").slice(0, 120)}`);
    // browserSkipped = runtime/layout/kontras TIDAK diperiksa -> belum bukti lolos (fail-closed).
    if (j.browserSkipped) findings.unshift("error:check/browser_skipped:runtime/layout/kontras tidak dijalankan");
    const res: HfGateResult = { ran: true, ok: errors === 0 && j.ok !== false && !j.browserSkipped, errors: errors + (j.browserSkipped ? 1 : 0), warnings, findings, ms: 0 };
    if (opts.snapshotAt?.length) {
      const snapshotDir = `${dir}/.qc-snapshots`;
      await run("npx", [...cli, "snapshot", `--at=${opts.snapshotAt.map((t) => t.toFixed(2)).join(",")}`, `--output=${snapshotDir}`, dir], o);
      res.snapshotDir = snapshotDir;
    }
    res.ms = Date.now() - t0;
    return res;
  } catch (e) {
    return { ran: true, ok: false, errors: 1, warnings: 0, findings: [`gate_error:${String((e as Error)?.message || e).slice(0, 160)}`], ms: Date.now() - t0 };
  }
}

export type FrameStat = { t: number; yavg: number; yspread: number }; // luma 0-255; spread = YHIGH-YLOW (persentil 90-10) dari ffmpeg signalstats
export type QcAction = "render" | "retry" | "fallback" | "reject";
export type QcDecision = { action: QcAction; reason: string };
export type QcInput = {
  pre?: QcIssue[];
  gate?: HfGateResult;
  renderError?: string | null;   // pesan error render (null = sukses)
  attempt?: number;              // percobaan render ke-n (1-based)
  maxAttempts?: number;          // default 2
  frames?: FrameStat[];          // statistik frame hasil render
  fallbackAvailable: boolean;    // jalur ffmpeg/komposisi lama bisa dipakai
};

const blank = (f: FrameStat) => f.yavg < 10 || f.yspread < 3; // hitam / layar polos
const transient = (e: string) => /ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|fetch failed|\b50[234]\b|\b429\b/i.test(e);
const noRetry = (e: string) => /timeout render|queue_full|antrean penuh|queue_timeout|antre >|LEDGER|401|403/i.test(e);

// Urutan: (a) cacat struktur/gate -> fallback (atau tolak bila fallback tak ada). (b) error render: transient &
// masih ada jatah -> retry; timeout/antrean/izin -> fallback langsung (sama dgn hyperframesClient). (c) frame:
// hook (t≈0) hitam atau ≥ 2 frame polos -> fallback. Fallback tak tersedia -> tolak (TIDAK masuk draf).
export function decideQc(i: QcInput): QcDecision {
  const fb = (reason: string): QcDecision => (i.fallbackAvailable ? { action: "fallback", reason } : { action: "reject", reason: `${reason}; fallback tak tersedia` });
  const preErr = (i.pre ?? []).filter((x) => x.level === "error");
  if (preErr.length) return fb(`pre_check: ${preErr.slice(0, 4).map((x) => x.code).join(",")}`);
  if (i.gate?.ran && !i.gate.ok) return fb(`hf_check: ${i.gate.errors} error (${i.gate.findings.slice(0, 2).join(" | ")})`);
  if (i.renderError) {
    const e = i.renderError, att = i.attempt ?? 1, max = i.maxAttempts ?? 2;
    if (!noRetry(e) && transient(e) && att < max) return { action: "retry", reason: `transient (${e.slice(0, 60)}), percobaan ${att + 1}/${max}` };
    return fb(`render_error: ${e.slice(0, 80)}`);
  }
  if (i.frames?.length) {
    const hook = i.frames.find((f) => f.t <= 0.6);
    if (hook && blank(hook)) return fb(`hook_blank (t=${hook.t}s luma ${hook.yavg.toFixed(0)})`);
    const bad = i.frames.filter(blank);
    if (bad.length >= 2) return fb(`blank_frames: ${bad.map((f) => f.t).join(",")}s`);
  }
  if (i.renderError === undefined && !i.frames) return { action: "render", reason: `pre_check lolos${i.gate?.ran ? `, hf_check lolos (${i.gate.warnings} warn)` : ""}` };
  return { action: "render", reason: "hasil render lolos QC frame" };
}

// Metrik dari autoFixLog project (step render_queue / render_fallback / render_routing).
export type LogEntry = { step: string; action: string; result: string };
export function summarizeRenderMetrics(logs: LogEntry[][], opts: { workerUsdPerHour?: number; aiUsdPerVideo?: number } = {}) {
  const renderMs: number[] = [], waitMs: number[] = [];
  const c = { videos: logs.length, hfAttempted: 0, ok: 0, fallback: 0, queueFull: 0, queueTimeout: 0, renderTimeout: 0, retry: 0, dedup: 0, routedFfmpeg: 0 };
  for (const log of logs) {
    const q = log.filter((e) => e.step === "render_queue");
    if (q.length) c.hfAttempted++;
    for (const e of q) {
      const r = /render (\d+)ms/.exec(e.action); if (r) { renderMs.push(+r[1]); if (e.result === "ok") c.ok++; }
      const w = /antre (\d+)ms/.exec(e.action); if (w) waitMs.push(+w[1]);
      if (e.result === "queue_full") c.queueFull++;
      if (e.result === "queue_timeout") c.queueTimeout++;
      if (e.result === "no_retry") c.renderTimeout++;
      if (e.result === "retry") c.retry++;
      if (e.result === "dedup") c.dedup++;
    }
    if (log.some((e) => e.step === "render_fallback")) c.fallback++;
    if (log.some((e) => e.step === "render_routing")) c.routedFfmpeg++;
  }
  const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
  const avgRenderS = renderMs.length ? renderMs.reduce((a, b) => a + b, 0) / renderMs.length / 1000 : 0;
  const workerCost = (avgRenderS / 3600) * (opts.workerUsdPerHour ?? 0);
  return {
    ...c,
    failRate: c.hfAttempted ? 1 - c.ok / c.hfAttempted : 0,
    fallbackRate: c.hfAttempted ? c.fallback / c.hfAttempted : 0,
    renderP50s: pct(renderMs, 0.5) / 1000, renderP95s: pct(renderMs, 0.95) / 1000,
    waitP50s: pct(waitMs, 0.5) / 1000, waitP95s: pct(waitMs, 0.95) / 1000,
    costPerVideoUsd: workerCost + (opts.aiUsdPerVideo ?? 0),
  };
}
