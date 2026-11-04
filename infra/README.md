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
| hf-tunnel.service | kunci privat SSH | `/home/admin/.ssh/hf_worker` (hanya PATH; isi kunci tak disalin) |
| hyperframes-render.service | `service.env` | tak disalin — berisi `HYPERFRAMES_RENDER_SECRET` + kredensial R2 |
| app (.env) | `HYPERFRAMES_RENDER_SECRET`, `HYPERFRAMES_RENDER_URL` | tak disalin |

## Topologi singkat
App (`:3200`, Node 20) → `hyperframesClient.ts` POST `http://127.0.0.1:3400/render` (+header `x-render-secret`)
→ tunnel autossh (`hf-tunnel.service`) → worker VPS `server.mjs` (`:3400`, Node 24) → `npx hyperframes render`
(Chromium headless + ffmpeg) → MP4 → balik ke app → app unggah ke R2. Detail alur/timeout/restart/rollback:
`docs/worker-queue-current.md`. Rancangan perbaikan antrean: `docs/worker-queue-design.md`.
