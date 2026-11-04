# Worker Render — alur, timeout, restart, rollback (KEADAAN SEKARANG, 2026-11-04)

Dokumentasi apa adanya dari kode/infra yang berjalan (`infra/worker/`, `src/lib/render/hyperframesClient.ts`).
Belum ada perubahan perilaku — ini baseline untuk Gerbang 2.

## 1. Alur antrean (queue)
1. `processProject` memanggil `renderViaHyperframes` → `hyperframesClient.renderComposition(html)`.
2. Client POST `http://127.0.0.1:3400/render`, header `x-render-secret`, body `{html, meta}`.
3. Request lewat **tunnel autossh** (`hf-tunnel.service`, app box) ke worker VPS `server.mjs` `:3400`.
4. Worker **men-serialisasi** render: `serial(fn)` merantai tiap render ke promise `tail` →
   **1 render berjalan sekali waktu** (hindari 2 Chromium barengan di box 2-core). Render berikut
   `await prev` dulu. **Tidak ada antrean eksplisit/berprioritas — murni FIFO rantai promise.**
5. Worker jalankan `npx hyperframes@0.8.230 render` (Chromium + ffmpeg) → ambil MP4 terakhir di `renders/`.
6. MP4 dibalas → app unggah ke R2 → `processProject` lanjut.

## 2. Timeout (NILAI NYATA)
| Lapis | Nilai | Sumber | Perilaku saat lewat |
|---|---|---|---|
| Worker render | **15 menit** (`RENDER_TIMEOUT_MS = 15*60*1000`) | `server.mjs:20` | `execFile` bunuh proses `npx` → 500 ke client |
| Client deadline | **28 menit** (`HYPERFRAMES_RENDER_DEADLINE_MS`) | `hyperframesClient.ts` | AbortController + timer → Error → **fallback ffmpeg** (`processProject`) |
| Routing proaktif | video est **> 210 dtk** | `processProject` | skip HyperFrames, **ffmpeg langsung** (hindari pasti-timeout) |

Catatan: client 28min > worker 15min → normalnya worker gagal/timeout lebih dulu dan client menerima error
(fallback). Client deadline adalah jaring pengaman kalau worker **menggantung tanpa membalas sama sekali**.

## 3. Masalah antrean yang DIKETAHUI (jadi sasaran Gerbang 2)
- **Antre makan deadline:** render yang menunggu di belakang `tail` tetap menghitung deadline client 28min.
  Kalau render di depan lambat/menggantung, render belakang bisa habis deadline **sebelum mulai**.
- **Timeout tetap pegang slot:** render yang menggantung baru melepas slot saat `execFile` timeout 15min.
  Selama itu SEMUA render lain blok (serial), walau sebenarnya sudah tak berguna.
- **Tak ada kuota per tenant:** satu tenant yang mengirim banyak render memonopoli worker serial.
- **Tak ada retry:** error sekali → langsung fallback ffmpeg (tak ada percobaan ulang singkat untuk
  kegagalan transient spt tunnel sesaat putus).

## 4. Restart
- Worker: di worker VPS `sudo systemctl restart hyperframes-render` (Restart=on-failure, RestartSec=3, MemoryMax=2G).
- Tunnel: di app box `sudo systemctl restart hf-tunnel` (Restart=always, RestartSec=5, autossh re-dial).
- Verifikasi tunnel hidup: `ss -ltnp | grep :3400` harus proses **ssh** (bukan node lokal — kalau node, berarti
  `hyperframes-render.service` keliru jalan di app box dan menyerobot :3400 → matikan).

## 5. Rollback worker (keadaan sekarang)
- Worker stateless (tak ada DB); rollback = `git`/rsync versi `server.mjs` sebelumnya di worker VPS + restart.
- Pin versi `hyperframes@0.8.230` di `server.mjs` → render deterministik; naikkan versi = keputusan terpisah.
- App-side: matikan jalur worker tanpa redeploy dengan set brand `brandKit.renderEngine` != `hyperframes`
  (default `ffmpeg`), atau set env `HYPERFRAMES_RENDER_URL` kosong → client gagal cepat → fallback ffmpeg.
