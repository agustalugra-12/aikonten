// Tahap 8: QC pre-render + keputusan QC + metrik + review frame. Jalankan: npx tsx scripts/verify-render-qc.ts
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildComposition } from "../src/lib/render/hyperframesComposition";
import { buildCompositionFromPlan } from "../src/lib/video/planBuilder";
import { staticPreCheck, decideQc, runHfGate, summarizeRenderMetrics, type HfGateResult } from "../src/lib/video/renderQc";
import type { VideoPlan } from "../src/lib/video/videoPlan";
import { GOLDEN_INPUTS } from "./hf-golden-inputs";
import { loadFixture, DOMAINS } from "./verify-videoplan";
import { mediaFor } from "./verify-videoplan-builder";

let n = 0;
const ok = (m: string) => console.log(`  ok ${++n} - ${m}`);
const hosts = { allowedMediaHosts: ["r2.example"] };
const errs = (h: string) => staticPreCheck(h, hosts).filter((x) => x.level === "error").map((x) => x.code);

(async () => {
  // 1. Komposisi sah (jalur lama + 4 plan) lolos pre-check.
  for (const [k, v] of Object.entries(GOLDEN_INPUTS)) assert.deepStrictEqual(errs(buildComposition(v)), [], `lama ${k}`);
  for (const d of DOMAINS) assert.deepStrictEqual(errs(buildCompositionFromPlan(loadFixture(d).valid as unknown as VideoPlan, mediaFor(d)).html), [], `plan ${d}`);
  ok("pre-check: 4 komposisi lama + 4 komposisi VideoPlan lolos tanpa error");

  // 2. Cacat terdeteksi.
  const good = buildComposition(GOLDEN_INPUTS.full);
  const cases: Array<[string, string]> = [
    [good.replace("./vendor/gsap.min.js", "https://cdn.jsdelivr.net/gsap.js"), "external_script"],
    [good.replace("</style>", "</style><link rel=stylesheet href=https://fonts.googleapis.com/x>"), "external_link"],
    [good.replace('src="https://r2.example/a.mp4"', 'src="data:video/mp4;base64,AAAA"'), "media_inline"],
    [good.replace('src="https://r2.example/a.mp4"', 'src="https://evil.example/a.mp4"'), "media_host"],
    [good.replace('id="cta"', 'id="ctaX"'), "missing_target"],
    [good.replace('id="vignette"', 'id="scrim"'), "duplicate_id"],
    [good.replace(/data-duration="([\d.]+)" data-media-start/, 'data-duration="99" data-media-start'), "media_past_end"],
    [good.replace('window.__timelines["main"]=tl', ""), "no_timeline"],
    [good.replace(/url\("\.\/fonts\/poppins-400\.woff2"\)/, 'url("https://fonts.gstatic.com/p.woff2")'), "external_url"],
  ];
  for (const [h, code] of cases) assert.ok(errs(h).includes(code), `harus deteksi ${code}: ${errs(h)}`);
  ok(`pre-check mendeteksi ${cases.length} cacat (CDN script/link/url, media base64/host asing, target animasi hilang, id ganda, media lewat durasi, timeline tak terdaftar)`);

  // 3. Matriks keputusan QC.
  const gateBad: HfGateResult = { ran: true, ok: false, errors: 2, warnings: 0, findings: ["error:overflow:x"], ms: 1 };
  const D = (i: Parameters<typeof decideQc>[0]) => decideQc(i).action;
  assert.strictEqual(D({ pre: [], fallbackAvailable: true }), "render");
  assert.strictEqual(D({ pre: [{ level: "warn", code: "many_videos", detail: "" }], fallbackAvailable: true }), "render");
  assert.strictEqual(D({ pre: [{ level: "error", code: "external_script", detail: "" }], fallbackAvailable: true }), "fallback");
  assert.strictEqual(D({ pre: [{ level: "error", code: "external_script", detail: "" }], fallbackAvailable: false }), "reject");
  assert.strictEqual(D({ gate: gateBad, fallbackAvailable: true }), "fallback");
  assert.strictEqual(D({ renderError: "fetch failed ECONNRESET", attempt: 1, fallbackAvailable: true }), "retry");
  assert.strictEqual(D({ renderError: "fetch failed ECONNRESET", attempt: 2, fallbackAvailable: true }), "fallback");
  assert.strictEqual(D({ renderError: "timeout render 25min", attempt: 1, fallbackAvailable: true }), "fallback");
  assert.strictEqual(D({ renderError: "antrean penuh (>= 3) 503", attempt: 1, fallbackAvailable: true }), "fallback");
  assert.strictEqual(D({ renderError: "401 unauthorized", attempt: 1, fallbackAvailable: false }), "reject");
  assert.strictEqual(D({ renderError: null, frames: [{ t: 0, yavg: 3, yspread: 0 }, { t: 1, yavg: 120, yspread: 90 }], fallbackAvailable: true }), "fallback");
  assert.strictEqual(D({ renderError: null, frames: [{ t: 0, yavg: 90, yspread: 80 }, { t: 3, yavg: 2, yspread: 1 }, { t: 9, yavg: 4, yspread: 0 }], fallbackAvailable: true }), "fallback");
  assert.strictEqual(D({ renderError: null, frames: [{ t: 0, yavg: 90, yspread: 80 }, { t: 9, yavg: 4, yspread: 0 }], fallbackAvailable: true }), "render", "1 frame gelap (mis. fade akhir) masih boleh");
  assert.ok(/hook_blank/.test(decideQc({ renderError: null, frames: [{ t: 0, yavg: 3, yspread: 0 }], fallbackAvailable: true }).reason));
  ok("keputusan QC: render / retry (transient, jatah) / fallback (cacat, timeout, antrean, hook hitam, ≥2 frame polos) / reject (tanpa fallback) + alasan");

  // 4. hyperframes check gate: flag OFF tak mengeksekusi apa pun; ON memparse JSON; error eksekusi = fail-closed.
  let called = 0;
  const fakeExec = ((cmd: string, args: string[], _o: unknown, cb: (e: Error | null, r: { stdout: string; stderr: string }) => void) => {
    called++;
    if (args.includes("check")) cb(null, { stdout: JSON.stringify({ ok: true, issues: [{ severity: "warning", code: "contrast", message: "low" }] }), stderr: "" });
    else cb(null, { stdout: "{}", stderr: "" });
  }) as unknown as typeof import("node:child_process").execFile;
  assert.strictEqual((await runHfGate("/x", { env: {}, exec: fakeExec })).ran, false); assert.strictEqual(called, 0);
  const g = await runHfGate("/x", { env: { HF_PRERENDER_CHECK: "1" }, exec: fakeExec, snapshotAt: [0, 1, 3] });
  assert.ok(g.ran && g.ok && g.warnings === 1 && g.snapshotDir === "/x/.qc-snapshots" && Number(called) === 2);
  const boom = ((_c: string, _a: string[], _o: unknown, cb: (e: Error) => void) => cb(new Error("ENOENT npx"))) as unknown as typeof import("node:child_process").execFile;
  const gb = await runHfGate("/x", { env: { HF_PRERENDER_CHECK: "1" }, exec: boom });
  assert.ok(gb.ran && !gb.ok && decideQc({ gate: gb, fallbackAvailable: true }).action === "fallback");
  ok("hyperframes check+snapshot: flag OFF = 0 eksekusi; ON = JSON diparse + snapshot; gagal eksekusi = fail-closed -> fallback");

  // 5. Metrik dari autoFixLog (format persis hyperframesClient).
  const m = summarizeRenderMetrics([
    [{ step: "render_queue", action: "antre 1200ms", result: "dequeued" }, { step: "render_queue", action: "render 95000ms", result: "ok" }],
    [{ step: "render_queue", action: "antre 300ms", result: "dequeued" }, { step: "render_queue", action: "transient: x -> retry#1 +5000ms", result: "retry" }, { step: "render_queue", action: "render 120000ms", result: "ok" }],
    [{ step: "render_queue", action: "antrean penuh (>= 3) -> fallback ffmpeg", result: "queue_full" }, { step: "render_fallback", action: "x", result: "fallback" }],
    [{ step: "render_routing", action: "video ~260s > 210s", result: "routed_ffmpeg" }],
  ], { workerUsdPerHour: 0.06, aiUsdPerVideo: 0.0017 });
  assert.deepStrictEqual([m.videos, m.hfAttempted, m.ok, m.fallback, m.queueFull, m.retry, m.routedFfmpeg], [4, 3, 2, 1, 1, 1, 1]);
  assert.ok(Math.abs(m.failRate - 1 / 3) < 1e-9 && m.renderP50s === 120 && m.waitP95s === 1.2);
  assert.ok(Math.abs(m.costPerVideoUsd - ((107.5 / 3600) * 0.06 + 0.0017)) < 1e-9);
  ok("metrik: render p50/p95, antre, gagal/fallback/retry/antrean penuh/routing, biaya per video (worker + AI)");

  // 6. Skrip review frame pada video sintetis (2 dtk hitam lalu pola) -> hook hitam -> fallback.
  const dir = mkdtempSync(join(tmpdir(), "hfqc-"));
  const mp4 = join(dir, "t.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=black:s=180x320:d=2", "-f", "lavfi", "-i", "testsrc=s=180x320:d=4", "-f", "lavfi", "-i", "sine=f=440:d=6", "-filter_complex", "[0][1]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-map", "2", "-shortest", "-pix_fmt", "yuv420p", mp4]);
  const outRaw = execFileSync("npx", ["tsx", join(__dirname, "hf-frame-review.ts"), mp4, dir, "syn"], { encoding: "utf8" });
  const rep = JSON.parse(readFileSync(join(dir, "syn-review.json"), "utf8"));
  assert.ok(rep.frames.length === 5 && rep.hasAudio && rep.qc.action === "fallback" && /hook_blank/.test(rep.qc.reason), outRaw);
  assert.ok(rep.frames.find((f: { t: number }) => f.t === 3).yavg > 40);
  ok("hf-frame-review: 5 frame (0/1/3/tengah/akhir) + luma + audio + contact sheet; hook hitam -> fallback");
  console.log(`ALL_RENDER_QC_TESTS_PASS (${n} tes)`);
})().catch((e) => { console.error(e); process.exit(1); });
