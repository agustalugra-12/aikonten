// Tes integrasi antrean hyperframesClient (Gerbang 2) dgn SERVER TIRUAN (nol worker/VPS nyata).
// npx tsx scripts/verify-hyperframes-queue.ts. Cakup: flag-off identik, duplicate job, worker hang,
// 502 lalu sukses, timeout tanpa retry, fallback via queue-timeout. (Antrean ADIL = verify-worker-queue.ts.)
import http from "node:http";
import assert from "node:assert";
import { renderComposition, QUEUE_TIMEOUT_DEFAULT_MS, TYPICAL_RENDER_MS } from "@/lib/render/hyperframesClient";
import { renderViaScenes } from "@/lib/render/renderViaScenes";

let n = 0;
const ok = (m: string) => { n++; console.log(`  ok ${n} - ${m}`); };

(async () => {
  let reqCount = 0;
  let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => {};
  const server = http.createServer((req, res) => { reqCount++; req.on("data", () => {}); req.on("end", () => handler(req, res)); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const sendMp4 = (res: http.ServerResponse) => { res.writeHead(200, { "content-type": "video/mp4", "content-length": 3 }); res.end(Buffer.from("mp4")); };

  // 1. FLAG OFF -> jalur lama: 1 request, hasil benar, TAK ada queue-log (identik produksi).
  process.env.HYPERFRAMES_QUEUE_ENABLED = "0";
  {
    reqCount = 0; let logs = 0; handler = (_q, res) => sendMp4(res);
    const buf = await renderComposition("<html>", { id: "p" }, { url }, { tenantId: "t", projectId: "p", contentHash: "h", log: () => { logs++; } });
    assert.strictEqual(buf.toString(), "mp4");
    assert.strictEqual(reqCount, 1, "flag off -> 1 request langsung");
    assert.strictEqual(logs, 0, "flag off -> NOL queue-log (perilaku identik)");
    ok("flag OFF: jalur lama, 1 request, nol queue-log");
  }

  process.env.HYPERFRAMES_QUEUE_ENABLED = "1"; // sisanya flag ON

  // 2. DUPLICATE JOB (jobId sama, concurrent) -> server 1 request (dedup), 2 hasil sama.
  {
    reqCount = 0; handler = (_q, res) => setTimeout(() => sendMp4(res), 30); // tunda biar 2 call overlap
    const p1 = renderComposition("<h>", { id: "p" }, { url, deadlineMs: 5000 }, { tenantId: "tA", projectId: "dup", contentHash: "hh" });
    const p2 = renderComposition("<h>", { id: "p" }, { url, deadlineMs: 5000 }, { tenantId: "tA", projectId: "dup", contentHash: "hh" });
    const [b1, b2] = await Promise.all([p1, p2]);
    assert.strictEqual(reqCount, 1, "dedup -> HANYA 1 request ke worker (anti render ganda)");
    assert.strictEqual(b1.toString(), "mp4"); assert.strictEqual(b2.toString(), "mp4");
    ok("duplicate job -> 1 render (dedup), hasil dibagi");
  }

  // 3. WORKER HANG + deadline pendek -> reject timeout (fallback).
  {
    reqCount = 0; handler = () => { /* tak pernah balas */ };
    await assert.rejects(
      renderComposition("<h>", { id: "p" }, { url, deadlineMs: 120 }, { tenantId: "tH", projectId: "hang", contentHash: "h" }),
      /timeout|fallback/i,
    );
    ok("worker hang -> timeout -> reject (fallback)");
  }

  // 4. 502 LALU SUKSES: request#1 502, request#2 200 -> retry transient -> sukses (2 request).
  {
    reqCount = 0; handler = (_q, res) => { if (reqCount === 1) { res.writeHead(502, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "bad gateway" })); } else sendMp4(res); };
    const buf = await renderComposition("<h>", { id: "p" }, { url, deadlineMs: 8000 }, { tenantId: "t502", projectId: "retry", contentHash: "h" });
    assert.strictEqual(buf.toString(), "mp4");
    assert.strictEqual(reqCount, 2, "502 -> retry -> 200 (tepat 2 request)");
    ok("502 lalu sukses: retry transient berhasil");
  }

  // 5. TIMEOUT TANPA RETRY: server hang + deadline pendek -> __renderTimeout -> TIDAK di-retry (1 request).
  {
    reqCount = 0; handler = () => { /* hang */ };
    await assert.rejects(renderComposition("<h>", { id: "p" }, { url, deadlineMs: 120 }, { tenantId: "tT", projectId: "noretry", contentHash: "h" }));
    assert.strictEqual(reqCount, 1, "timeout render TIDAK di-retry (hanya 1 request)");
    ok("timeout tanpa retry (1 request)");
  }

  // 6. FALLBACK via QUEUE-TIMEOUT: job A tahan slot (serial), job B nunggu > batas -> fallback tanpa hit server.
  process.env.HYPERFRAMES_QUEUE_TIMEOUT_MS = "50";
  {
    reqCount = 0; handler = () => { /* A hang tahan slot sampai deadline-nya */ };
    const pA = renderComposition("<h>", { id: "p" }, { url, deadlineMs: 400 }, { tenantId: "qA", projectId: "occupy", contentHash: "h1" }).catch(() => "A-selesai");
    await new Promise((r) => setTimeout(r, 15)); // beri A waktu ambil slot + kirim request
    const reqAfterA = reqCount;
    await assert.rejects(
      renderComposition("<h>", { id: "p" }, { url, deadlineMs: 400 }, { tenantId: "qB", projectId: "waiter", contentHash: "h2" }),
      (e: unknown) => /queue timeout/i.test(String((e as Error).message)),
    );
    assert.strictEqual(reqCount, reqAfterA, "job B tak pernah hit server (fallback dari ANTREAN, bukan sibuk=langsung-fallback)");
    await pA; // biarkan A selesai (deadline) -> lepas timer, proses bisa keluar
    ok("fallback via queue-timeout: nunggu > batas -> fallback tanpa render");
  }
  delete process.env.HYPERFRAMES_QUEUE_TIMEOUT_MS;

  // 7. "Dua render 6 menit tidak fallback": (a) basis numerik + (b) mekanisme (skala kecil).
  {
    assert.ok(QUEUE_TIMEOUT_DEFAULT_MS >= 2 * TYPICAL_RENDER_MS, `default queue-timeout (${QUEUE_TIMEOUT_DEFAULT_MS}ms) >= 2x render tipikal 6min`);
    process.env.HYPERFRAMES_QUEUE_TIMEOUT_MS = "5000";
    reqCount = 0; handler = (_q, res) => setTimeout(() => sendMp4(res), 80); // render "lama" (skala 80ms)
    const r1 = renderComposition("<h>", { id: "p" }, { url, deadlineMs: 10000 }, { tenantId: "slow", projectId: "a", contentHash: "1" });
    const r2 = renderComposition("<h>", { id: "p" }, { url, deadlineMs: 10000 }, { tenantId: "slow", projectId: "b", contentHash: "2" });
    const [b1, b2] = await Promise.all([r1, r2]);
    assert.strictEqual(b1.toString(), "mp4"); assert.strictEqual(b2.toString(), "mp4");
    assert.strictEqual(reqCount, 2, "dua render antre LALU SUKSES (tak fallback)");
    delete process.env.HYPERFRAMES_QUEUE_TIMEOUT_MS;
    ok("dua render 6-menit (skala) antre -> sukses tanpa fallback + basis numerik");
  }

  // 8. Antrean mencapai BATAS -> queue_full -> fallback (tak numpuk tanpa batas).
  {
    process.env.HYPERFRAMES_QUEUE_MAX = "1";
    reqCount = 0; handler = () => { /* A hang tahan slot */ };
    const pA = renderComposition("<h>", { id: "p" }, { url, deadlineMs: 300 }, { tenantId: "f1", projectId: "A", contentHash: "a" }).catch(() => "A");
    await new Promise((r) => setTimeout(r, 15)); // A ambil slot + kirim
    const pB = renderComposition("<h>", { id: "p" }, { url, deadlineMs: 300 }, { tenantId: "f2", projectId: "B", contentHash: "b" }).catch(() => "B"); // B menunggu (waiting=1=max)
    await new Promise((r) => setTimeout(r, 5));
    const reqBefore = reqCount;
    await assert.rejects(
      renderComposition("<h>", { id: "p" }, { url, deadlineMs: 300 }, { tenantId: "f3", projectId: "C", contentHash: "c" }),
      (e: unknown) => /queue full/i.test(String((e as Error).message)),
    );
    assert.strictEqual(reqCount, reqBefore, "job C (antrean penuh) tak hit server -> fallback");
    await Promise.all([pA, pB]);
    delete process.env.HYPERFRAMES_QUEUE_MAX;
    ok("antrean mencapai batas -> queue_full -> fallback (tanpa menunggu tak terbatas)");
  }

  // 9. renderViaScenes IKUT antrean (per-adegan brand+project+contentHash). ffmpeg concat mp4-tiruan boleh gagal;
  //    yg diuji: tiap scene render LEWAT antrean (bukan bypass).
  {
    const prevUrl = process.env.HYPERFRAMES_RENDER_URL;
    process.env.HYPERFRAMES_RENDER_URL = url;
    reqCount = 0; handler = (_q, res) => sendMp4(res);
    const qlogs: string[] = [];
    await renderViaScenes({ projectId: "scn", brandId: "scenesT", hookText: "Judul Uji", onQueueEvent: (s) => { qlogs.push(s); } }).catch(() => { /* ffmpeg concat mp4-tiruan gagal — render scene sudah lewat antre */ });
    assert.ok(reqCount >= 2, `scenes render tiap adegan ke worker via antre (req=${reqCount})`);
    assert.ok(qlogs.includes("render_queue"), "scene render LEWAT antrean (ada log render_queue), bukan bypass");
    if (prevUrl === undefined) delete process.env.HYPERFRAMES_RENDER_URL; else process.env.HYPERFRAMES_RENDER_URL = prevUrl;
    ok("renderViaScenes ikut antrean per-adegan (tak memonopoli, tak bypass)");
  }

  // 10. Koneksi PUTUS setelah request (ECONNRESET/socket hang up) -> TIDAK retry (tak kirim render kedua).
  {
    reqCount = 0; handler = (_q, res) => { res.socket?.destroy(); }; // drop koneksi setelah request diterima
    await assert.rejects(renderComposition("<h>", { id: "p" }, { url, deadlineMs: 5000 }, { tenantId: "rst", projectId: "x", contentHash: "h" }));
    assert.strictEqual(reqCount, 1, "ECONNRESET setelah request -> 1 request saja (tak render ganda)");
    ok("koneksi putus setelah request -> tak kirim render kedua");
  }

  server.close();
  console.log(`ALL_HQ_TESTS_PASS (${n} tes)`);
})();
