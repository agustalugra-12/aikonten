# Rancang ulang antrean worker — Tahap 3 (2026-11-04, berbasis WORKER AKTIF, PRE-Gerbang 2, BELUM diwire)

Berdasarkan worker nyata (4-core/8GB, Node 24.22.2, render **serial** `serial()`, `RENDER_TIMEOUT_MS 25min`,
`--workers N --sdr`, **tanpa job-id/status/cancel**). Helper murni di `src/lib/render/workerQueue.ts`
(teruji mock, **belum dipanggil** `processProject` — nol dampak prod). Wiring = PASCA-Gerbang 2.

## Masalah → rancangan

### (3-1) Waktu antre harus DIKETAHUI — job id + status / antre di app
Worker sekarang FIFO buta (serial, tak ada id/status). Dua opsi, **kita pilih antre di APP** (tak perlu ubah
worker untuk ini):
- **Antre di app (`FairScheduler`)**: app yang memegang antrean + konkurensi ke worker. Posisi antre terlihat
  (`waitingCount`, `runningCount`) → `estimateWaitMs({aheadInQueue, running, maxConcurrent, avgRenderMs})`
  memberi perkiraan tunggu SEBELUM mengirim ke worker. Kalau perkiraan > sisa budget → fallback ffmpeg
  (tak mengantre sia-sia).
- **Job id + status (opsional, perlu worker)**: `makeJobId(tenant, projectId, contentHash)`; worker balas id +
  endpoint `GET /status/:id`. Berguna kalau nanti antre pindah ke worker/multi-instance. Didokumentasikan,
  tak wajib untuk Gerbang 2.

### (3-2) Timeout harus MEMBATALKAN proses render worker, bukan hanya client
Sekarang: client Abort tak menghentikan proses di worker (tetap jalan sampai 25min → tahan slot serial).
Rancangan: `runWithSlotTimeout(fn, slotMs, { onTimeout })`. Saat timeout → abort client **lalu panggil
`onTimeout()`** = `POST /cancel/:jobId` ke worker untuk mengakhiri proses render (kill child `npx`).
**Perubahan worker yang diperlukan (gated, butuh akses VPS — BUKAN sekarang):** server.mjs simpan child proc
per jobId; endpoint `/cancel/:id` → `child.kill("SIGTERM")`; `serial()` lepas slot saat dibatalkan. Sampai itu
ada, `onTimeout` minimal mencatat + abort client (perilaku aman, fallback ffmpeg tetap jalan).

### (3-3) Kuota per tenant harus MENGANTRE ADIL, bukan langsung fallback
Ganti reject-saat-contention dengan `FairScheduler` (round-robin by **served-count**: tenant paling sedikit
dilayani menang; tie → urutan kedatangan). Job **menunggu giliran** (fair, anti-monopoli worker serial), bukan
ditolak. Fallback HANYA kalau `estimateWaitMs > budget` (tunggu pasti melampaui deadline).

### (3-4) Hindari render GANDA saat retry
`makeJobId` deterministik dari (tenant, projectId, contentHash). `InFlightRegistry.run(jobId, start)`: kalau
jobId sedang in-flight → kembalikan promise yang SAMA (`deduped:true`), **tak men-start render kedua**. Retry
transient memakai jobId sama → aman (tak dobel). Timeout render **tidak** di-retry (`isRetriable` → false;
mahal + cenderung berulang) → langsung fallback.

## Kebijakan retry
`nextRetryDelayMs(attempt, {maxAttempts, baseMs, capMs})` exponential backoff di-cap; habis → `null` → fallback.
Hanya kegagalan PRE-WORKER via `isRetriable` (lihat Revisi di bawah: `ECONNREFUSED`+`502/503` saja — BUKAN ECONNRESET/socket-hang-up/timeout). Default: `maxAttempts=2, baseMs=1500, capMs=8000`.

## Interaksi fallback ffmpeg (aman, sudah ada di processProject)
Bermuara ke fallback ffmpeg existing: `proceed=false` (budget), `estimateWaitMs>budget`, `reason:"timeout"/"error"`,
retry habis (`null`). Nol perubahan perilaku observe/engine ffmpeg.

## Rencana wiring PASCA-Gerbang 2 (belum dikerjakan)
1. App: 1 `FairScheduler` global (maxConcurrent=1, sesuai worker serial; naikkan bila worker diparalelkan).
   `hyperframesClient` diberi `tenantId` + `makeJobId`; `InFlightRegistry` bungkus submit; `estimateWaitMs` vs
   budget → antre atau fallback; `runWithSlotTimeout` dengan `onTimeout` = POST `/cancel/:id`.
2. Worker (GATED, ubah VPS): endpoint `/cancel/:id` + simpan child per id + (opsional) `/status/:id` + id balik.
3. `processProject`: map hasil → fallback ffmpeg (sudah ada) + catat sebab ke `autoFixLog`.

## Risiko
- Antre/registry **in-memory per-instance** — cukup utk 1 instance app sekarang; multi-instance perlu store
  bersama (Redis) + id/status di worker. Dicatat, bukan sekarang.
- `/cancel` belum ada di worker → sampai ditambah (gated), timeout hanya abort client; proses worker lama masih
  menahan slot serial sampai 25min. Mitigasi penuh = langkah worker di atas (perlu Gerbang + akses VPS).
- `maxConcurrent` harus cocok dengan kapasitas worker serial (1). Salah set → kelebihan antre/timeout.

## Revisi (2026-11-04): dasar angka queue-timeout + batas antrean + retry dipersempit + scenes
- **Dasar durasi render:** HyperFrames hanya me-render video <=210s (`HYPERFRAMES_MAX_SECONDS`, processProject; di atas itu ffmpeg langsung). Jalur SDR ~4.8fps: 210s@30fps = 6300 frame / 4.8 =~ **22 menit** (mendekati cap worker 25min); video ~60s = 1800/4.8 =~ **6 menit**. Jadi render TIPIKAL ~6 menit, WORST ~22-25 menit.
- **Default `HYPERFRAMES_QUEUE_TIMEOUT_MS` = 25 menit** (dulu 5min terlalu agresif -> antrean normal jatuh ke ffmpeg). Basis: satu job boleh menunggu ~satu render worst-case di depannya; lebih dari itu, job di depan sudah kena timeout worker -> slot bebas. `QUEUE_TIMEOUT_DEFAULT_MS >= 2x render tipikal 6min` (diuji numerik).
- **Batas antrean `HYPERFRAMES_QUEUE_MAX` = 8** job MENUNGGU (basis: queueTimeout/tipikal = 25/6 =~ 4 + margin). Penuh -> tolak cepat (`__queueFull` -> fallback), bukan menunggu tanpa batas.
- **Retry dipersempit (idempoten-aman):** HANYA `ECONNREFUSED` + `502/503` (pre-worker/tunnel menolak sebelum meneruskan). BUKAN `ECONNRESET`, `socket hang up`, `ETIMEDOUT`, `504`, atau timeout -> koneksi bisa putus SETELAH request terkirim (worker mungkin sedang render) -> retry = risiko render ganda.
- **renderViaScenes ikut antrean:** tiap adegan di-render via `renderComposition` dengan queueOpts (brand + `${projectId}-s{i}` + contentHash per adegan) -> N render satu video scenes ikut fair-scheduler per tenant -> tak memonopoli worker tanpa batas.
