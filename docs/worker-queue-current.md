# Worker Render — alur, timeout, restart, rollback (WORKER AKTIF, 2026-11-04)

Diambil **read-only langsung dari worker VPS** (bukan salinan app box, yang ternyata STALE). Bukti & beda di §0.

## 0. Bukti worker aktif + perbedaan dari snapshot lama (app box)
| Bukti (read-only worker) | Nilai |
|---|---|
| nproc | **4** |
| MemTotal | **8144156 kB (~8 GB)** |
| systemd unit | `active (running)`, desc "HyperFrames Render Service (worker 4-core)" |
| Node | **v24.22.2** |
| server.mjs sha256 | `66a89a7eb5fe6604d37659a6104a94841ca80251a3dd072e92f3bf47412e04bb` |

(Hostname worker diverifikasi langsung; tidak dicatat di repo publik ini.)

**server.mjs AKTIF vs snapshot app-box lama** (`ac82c0f7…`, 106 baris → aktif `66a89a7e…`, 107 baris):
| Hal | Snapshot lama (app box, SALAH) | Worker AKTIF |
|---|---|---|
| `RENDER_TIMEOUT_MS` | 15 menit | **25 menit** |
| perintah render | `npx … render` | `npx … render --workers {cpus().length} --video-frame-format jpg --sdr` |
| bind | hardcoded `127.0.0.1` | `HF_BIND` env (default 127.0.0.1) |
| import | — | `+ cpus` dari `node:os` |
| path | `/home/admin/hyperframes-render` | `/root/hyperframes-render` |
| unit MemoryMax | 2G | **5G** |
| User | admin | root |

Catatan: komentar kode di baris 22 server.mjs MASIH tertulis "box 2-core/3.8GB" — itu **stale**; hardware
nyata 4-core/8GB (nproc/MemTotal di atas). `--sdr` = kunci jalur SDR cepat (~4.8fps) vs HDR layered (~0.6fps timeout).

## 1. Alur antrean (queue) — SEKARANG
1. `processProject` → `renderViaHyperframes` → `hyperframesClient.renderComposition(html)`.
2. Client POST `http://127.0.0.1:3400/render` (header `x-render-secret`), via tunnel autossh ke worker `:3400`.
3. Worker **men-serialisasi**: `serial(fn)` merantai tiap render ke promise `tail` → **1 render sekali waktu**.
   FIFO murni, **tanpa job id, tanpa /status, tanpa /cancel** → waktu antre TIDAK terlihat oleh app.
4. Worker: `npx hyperframes render --workers N --sdr` → MP4 terakhir di `renders/` → balas.
5. App unggah MP4 ke R2 → lanjut. (Worker TIDAK menyentuh R2.)

## 2. Timeout (NILAI NYATA worker aktif)
| Lapis | Nilai | Perilaku saat lewat |
|---|---|---|
| Worker render (`execFile` `npx`) | **25 menit** | proses `npx` dibunuh → 500 ke client. **Tapi tak ada endpoint cancel** → jika serial, render berikut tetap antre sampai ini. |
| Client deadline | **28 menit** (`HYPERFRAMES_RENDER_DEADLINE_MS`) | AbortController → Error → fallback ffmpeg. **Abort hanya di sisi client**; proses render di worker TETAP jalan sampai 25min. |
| Routing proaktif | est **> 210 dtk** | skip HyperFrames → ffmpeg langsung. |

## 3. Masalah yang DIKETAHUI (sasaran Gerbang 2)
- **Antre makan deadline & tak terlihat:** serial FIFO tanpa job id/status; render belakang bisa habis deadline 28min sebelum mulai; app tak tahu posisi antre.
- **Timeout tak membatalkan worker:** client abort TIDAK menghentikan proses render di worker; slot worker tetap dipakai sampai 25min.
- **Tak ada kuota per tenant:** satu tenant memonopoli worker serial.
- **Retry bisa render ganda:** tanpa idempotency, retry/submit ulang bisa memicu 2 render untuk konten sama.

## 4. Restart
- Worker VPS: `systemctl restart hyperframes-render` (Restart=on-failure, RestartSec=3, MemoryMax=5G).
- Tunnel (app box): `systemctl restart hf-tunnel` (autossh re-dial). Verifikasi: `ss -ltnp | grep :3400` harus **ssh**.

## 5. Rollback worker (sekarang)
- Worker stateless; rollback = kembalikan `server.mjs` versi sebelumnya (hash tercatat) + restart.
- `hyperframes@0.8.230` dipin → render deterministik.
- App-side kill-switch tanpa redeploy: `brandKit.renderEngine`≠`hyperframes` (→ffmpeg) atau `HYPERFRAMES_RENDER_URL` kosong (→gagal cepat→fallback).
