// Client ke worker render HyperFrames (Opsi C, 2026-11-02). POST komposisi HTML -> MP4 Buffer.
// URL via tunnel (hf-tunnel.service): default http://127.0.0.1:3400. Secret header.
// Deadline total sisi-klien (2026-11-03): worker bisa HANG (koneksi terbuka tapi tak pernah balas)
// -> dulu `req.setTimeout(0)` bikin request menggantung TAK TERBATAS (pipeline + worker serial macet,
// C fallback tak terpicu krn bukan error/response). Sekarang deadline 28min (> RENDER_TIMEOUT_MS
// worker 25min, jadi worker SEHAT sempat balas 500 duluan lewat jalur normal) -> abort + reject
// error jelas -> fallback ffmpeg di processProject jalan. Timer selalu dibersihkan saat sukses/gagal.
import http from "node:http";

const RENDER_URL = process.env.HYPERFRAMES_RENDER_URL || "http://127.0.0.1:3400";
const SECRET = process.env.HYPERFRAMES_RENDER_SECRET || "";
const RENDER_DEADLINE_MS = Number(process.env.HYPERFRAMES_RENDER_DEADLINE_MS) || 28 * 60 * 1000;

export async function renderComposition(
  html: string,
  meta?: { id?: string; name?: string },
  opts?: { deadlineMs?: number; url?: string }, // override utk tes (deadline pendek / server tiruan)
): Promise<Buffer> {
  const deadlineMs = opts?.deadlineMs ?? RENDER_DEADLINE_MS;
  const u = new URL(opts?.url || RENDER_URL);
  const payload = JSON.stringify({ html, meta: meta || { id: "app", name: "app" } });
  return new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Selesai SEKALI + selalu bersihkan timer (sukses/gagal/deadline) -> tak ada timer gantung.
    const done = (err: Error | null, buf?: Buffer) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (err) reject(err);
      else resolve(buf as Buffer);
    };
    const req = http.request(
      {
        host: u.hostname,
        port: Number(u.port || 80),
        path: "/render",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          "x-render-secret": SECRET,
        },
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
    // Deadline total (worker-hang guard): worker diam/tak balas -> reject jelas + tutup socket.
    // Error 'close'/ECONNRESET yg menyusul setelah destroy di-abaikan (settled sudah true).
    timer = setTimeout(() => {
      done(new Error(`HyperFrames render timeout sisi-klien ${Math.round(deadlineMs / 1000)}s (worker tak merespons) - fallback ffmpeg`));
      req.destroy();
    }, deadlineMs);
    req.write(payload);
    req.end();
  });
}
