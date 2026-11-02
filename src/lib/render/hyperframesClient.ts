// Client ke worker render HyperFrames (Opsi C, 2026-11-02). POST komposisi HTML -> MP4 Buffer.
// URL via tunnel (hf-tunnel.service): default http://127.0.0.1:3400. Secret header. TANPA timeout
// (render bisa beberapa menit; konsisten dgn processProject yg memang await render lama).
import http from "node:http";

const RENDER_URL = process.env.HYPERFRAMES_RENDER_URL || "http://127.0.0.1:3400";
const SECRET = process.env.HYPERFRAMES_RENDER_SECRET || "";

export async function renderComposition(html: string, meta?: { id?: string; name?: string }): Promise<Buffer> {
  const u = new URL(RENDER_URL);
  const payload = JSON.stringify({ html, meta: meta || { id: "app", name: "app" } });
  return new Promise<Buffer>((resolve, reject) => {
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
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const ct = String(res.headers["content-type"] || "");
          if (res.statusCode === 200 && ct.includes("video")) resolve(buf);
          else reject(new Error(`HyperFrames render gagal (${res.statusCode}): ${buf.toString("utf8").slice(0, 300)}`));
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(0);
    req.write(payload);
    req.end();
  });
}
