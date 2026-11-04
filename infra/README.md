# infra/ — snapshot worker render HyperFrames (Tahap 3, 2026-11-04)

Snapshot **read-only** konfigurasi worker render yang berjalan SEKARANG (bukan sumber deploy — VPS tidak
di-manage dari repo ini). Diambil untuk dokumentasi + perencanaan antrean (Gerbang 2). **Tidak ada perubahan
VPS dilakukan saat membuat snapshot ini.**

## Isi
- `worker/server.mjs` — HTTP render service worker (verbatim; tak ada secret hardcoded — secret via env).
- `worker/hyperframes-render.service` — systemd unit worker (jalan di worker VPS; DISABLED di app box).
- `worker/hf-tunnel.service` — systemd unit tunnel autossh di app box (:3400 → worker). **Host/port/kunci di-redact.**

## Secret yang DIHAPUS / tidak disalin (JANGAN commit)
| Tempat | Secret | Placeholder |
|---|---|---|
| hf-tunnel.service | IP/host worker | `<WORKER_HOST>` (asli di systemd app box) |
| hf-tunnel.service | port SSH worker | `<WORKER_SSH_PORT>` |
| hf-tunnel.service | kunci privat SSH | `<SSH_KEY_PATH>` (hanya PATH; isi kunci tak disalin) |
| hyperframes-render.service | `service.env` | tak disalin — keys: `HF_BIND`, `HF_PORT`, `HYPERFRAMES_RENDER_SECRET` (TANPA kredensial R2 — R2 upload di sisi app) |
| app (.env) | `HYPERFRAMES_RENDER_SECRET`, `HYPERFRAMES_RENDER_URL`, kredensial R2 | tak disalin |

## Sumber snapshot (2026-11-04)
Diambil **langsung dari worker VPS** (read-only, via tunnel key), BUKAN dari salinan app box (salinan app box
ternyata STALE/berbeda). Bukti & perbedaan: `docs/worker-queue-current.md`.

## Topologi singkat
App (`:3200`, Node 20) → `hyperframesClient.ts` POST `http://127.0.0.1:3400/render` (+header `x-render-secret`)
→ tunnel autossh (`hf-tunnel.service`, app box) → worker VPS `server.mjs` (`:3400`, Node 24.22.2, 4-core/8GB)
→ `npx hyperframes render --workers N --video-frame-format jpg --sdr` (Chromium + ffmpeg) → MP4 → balik ke app
→ **app** unggah ke R2. Detail alur/timeout/restart/rollback: `docs/worker-queue-current.md`.
Rancangan perbaikan antrean: `docs/worker-queue-design.md`.
