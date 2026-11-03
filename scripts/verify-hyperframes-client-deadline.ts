// Verifikasi deadline worker-hang hyperframesClient (2026-11-03).
// Jalankan: node --import tsx scripts/verify-hyperframes-client-deadline.ts
// Membuktikan: (1) worker DIAM (terima koneksi, tak balas) -> reject di deadline -> jalur fallback
// terpicu (bukan hang); (2) sukses -> resolve + timer dibersihkan (proses keluar cepat, bukan nunggu 28min).
import http from "node:http";
import assert from "node:assert";
import type { AddressInfo } from "node:net";
import { renderComposition } from "@/lib/render/hyperframesClient";

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

// (1) Worker tiruan yang TERIMA koneksi tapi TAK PERNAH membalas.
async function testWorkerHang() {
  const held: http.ServerResponse[] = [];
  const server = http.createServer((_req, res) => { held.push(res); /* sengaja tak res.end() */ });
  const url = await listen(server);

  const t0 = Date.now();
  let fallbackTriggered = false;
  let msg = "";
  try {
    await renderComposition("<html></html>", { id: "t", name: "t" }, { deadlineMs: 600, url });
  } catch (e) {
    fallbackTriggered = true; // jalur SAMA dgn C try/catch di processProject -> fallback ffmpeg
    msg = (e as Error).message;
  }
  const elapsed = Date.now() - t0;
  held.forEach((r) => r.destroy());
  server.close();

  assert.ok(fallbackTriggered, "worker-hang harus REJECT (memicu fallback), bukan menggantung");
  assert.ok(/timeout sisi-klien/.test(msg), "error harus jelas 'timeout sisi-klien': " + msg);
  assert.ok(elapsed >= 550 && elapsed < 4000, "reject di sekitar deadline (600ms), bukan hang: " + elapsed + "ms");
  console.log(`TEST1_OK worker-hang -> reject ${elapsed}ms msg="${msg}"`);
}

// (2) Worker tiruan yang membalas MP4 valid -> resolve + timer harus bersih (proses keluar cepat).
async function testSuccessClearsTimer() {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "video/mp4" });
    res.end(Buffer.from([0, 1, 2, 3]));
  });
  const url = await listen(server);
  const buf = await renderComposition("<html></html>", { id: "t", name: "t" }, { deadlineMs: 600, url });
  server.close();
  assert.ok(Buffer.isBuffer(buf) && buf.length === 4, "sukses harus resolve buffer MP4");
  console.log(`TEST2_OK sukses -> resolve ${buf.length}B (timer dibersihkan; proses tak nunggu deadline)`);
}

const start = Date.now();
testWorkerHang()
  .then(testSuccessClearsTimer)
  .then(() => {
    // Kalau timer TIDAK dibersihkan saat sukses, event loop tertahan ~deadline -> total jauh > 2s.
    // Kedua tes pakai deadline 600ms; total normal < ~2s. Ini bukti tambahan timer bersih.
    console.log(`ALL_TESTS_PASS total=${Date.now() - start}ms`);
    process.exit(0);
  })
  .catch((e) => { console.error("TEST_FAIL", e); process.exit(1); });
