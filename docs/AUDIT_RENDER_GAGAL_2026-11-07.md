# Audit kegagalan project (7 hari, s/d 2026-11-07)

Sumber: `projects` produksi, `sqlite3 -readonly`. Jendela: `created_at >= now-7d`.
Total: published 116, ready 61, **failed 55**, uploaded 9, publishing 1, partial 1, draft 1.
Tingkat gagal ~22% dari yang sudah selesai diproses.

## 1. Sebaran 55 kegagalan per kelas penyebab

| # | Kelas penyebab | Jml | % | Contoh pesan apa adanya |
|---|---|---|---|---|
| 1 | **Publish gagal "diam-diam"** (`projects.error_message` NULL; alasan sebenarnya hanya ada di `publish_logs`) | **31** | **56,4%** | `[{"message":"Access token is not valid","extensions":{"code":"UNAUTHENTICATED"…` dan `[{"message":"Too many requests from this client. Please try again later"…` |
| 2 | Quality Check gagal | 7 | 12,7% | `Quality Check gagal: Durasi video 6dtk di bawah minimum 30dtk`; `Quality Check gagal: Ada 20 detik layar hitam total (footage kemungkinan gagal dimuat/corrupt)` |
| 3 | ffmpeg gagal (proses systemd-run mati/non-zero) | 6 | 10,9% | `ffmpeg gagal: Command failed: systemd-run --wait --pipe --quiet --unit kontenpilot-ffmpeg-…` |
| 4 | HyperFrames render gagal (HTTP 500 dari worker) | 5 | 9,1% | `HyperFrames render gagal (500): {"error":"Command failed: npx --yes hyperframes@0.8.230 render…` |
| 5 | ffprobe tidak menghasilkan durasi valid | 2 | 3,6% | `ffprobe tidak menghasilkan durasi valid utk /tmp/kontenpilot_render_…/clip_0.mp4` |
| 6 | Durasi hasil render jauh di bawah target | 1 | 1,8% | `Video hasil render cuma 10 detik, di bawah minimum 150 detik (toleransi 120dtk)` |
| 7 | Antrian ffmpeg penuh | 1 | 1,8% | `antrian ffmpeg penuh (1 sedang berjalan), coba lagi nanti` |
| 8 | Footage/B-roll tidak cukup | 1 | 1,8% | `Footage/B-roll yg tersedia tidak cukup utk capai minimum 15 detik (cuma dapat ~0 detik…` |
| 9 | `FOREIGN KEY constraint failed` | 1 | 1,8% | `FOREIGN KEY constraint failed` |

### Hasil penelusuran 31 baris `error_message` NULL

Bukan "tidak diketahui" dan **bukan kegagalan render**:

* `auto_fix_attempts` NULL dan `auto_fix_log` kosong di ke-31 baris → pipeline generate tidak
  pernah masuk jalur auto-fix, artinya generate-nya tidak gagal.
* Ke-31 project punya **8–76 baris `publish_logs`, SEMUANYA `status='failed'`**, dengan dua
  pesan asli: `Access token is not valid` (UNAUTHENTICATED, token Buffer mati) dan
  `Too many requests from this client` (429 kuota Buffer). Pengulangan 8–76 kali = retry cron
  `auto-publish` berkali-kali.
* `updated_at` ke-31 project semuanya jatuh di 2026-11-04 10:45–12:46 (gelombang retry), padahal
  `created_at`-nya 10-31 s/d 11-03.

Jadi kelas terbesar adalah **kegagalan PUBLISH karena kredensial/kuota Buffer**, yang ditampilkan
ke pemilik sebagai "Gagal tanpa alasan".

### Sebaran per brand & tipe

| Brand | failed |
|---|---|
| Pelangi Homestay | 32 |
| Animal Story & Co | 10 |
| laundry in bali | 7 |
| agustap studio | 4 |
| harmoni | 2 |

| Tipe / format | failed |
|---|---|
| video / youtube_shorts | 31 |
| video / (tanpa format) | 18 |
| carousel / poster_feed | 6 |

Polanya: kelas "publish diam-diam" terkonsentrasi di Pelangi + laundry in bali (dua brand yang
pakai token Buffer yang mati, lihat catatan flow-control 2026-11-06). Kegagalan render murni
(ffmpeg/HyperFrames/ffprobe/QC) tersebar dan jumlahnya jauh lebih kecil.

## 2. Yang DIPERBAIKI: kelas #1 (31 kegagalan "diam-diam")

Akar masalah — formula status publish di-**salin 3 kali**, dan 2 salinan hanya menulis `status`
tanpa `errorMessage`:

* `src/lib/publish/orchestrate.ts:338-343` — sudah ditambal 865c597, tapi menulis `errorMessage`
  hanya kalau `summary` truthy (`...(summary ? { errorMessage: summary } : {})`), jadi project yang
  akhirnya `published` tetap menyimpan error lama yang sudah tidak relevan.
* `src/lib/publish/sweepRunner.ts:68-76` (`recomputeProjectStatus`) — `set({ status: st, updatedAt })`
  **tanpa** `errorMessage`.
* `src/lib/publish/bufferAuth.ts:271-274` (`verifyPublishSucceeded`) — `set({ status: correctedStatus,
  updatedAt })` **tanpa** `errorMessage`.

Dua yang terakhir justru jalur KOREKSI yang jalan ketika Buffer akhirnya melaporkan
`error`/macet — tepat skenario 31 project di atas.

Perbaikan: satu fungsi murni `summarizeProjectPublish(logs, connectedCount)` di
`src/lib/publish/projectStatus.ts`, dipakai ketiga tempat. `failed`/`partial` **selalu** membawa
alasan (termasuk fallback "tidak ada alasan tercatat di publish_logs" supaya pesan kosong tidak
pernah terjadi lagi), dan `published` membersihkan `error_message` lama. Sekalian menutup edge case
`ok === connected.length` → `>=`, supaya akun yang di-disconnect setelah publish sukses tidak
membuat project nyangkut `partial` selamanya dan diretry cron tanpa guna.

Tes: 8 kasus di `tests/critical.ts` (murni, tanpa DB/ffmpeg/Buffer).

**Yang sengaja TIDAK dikerjakan:** kelas #2–#9 (QC, ffmpeg, HyperFrames 500, ffprobe, footage,
FOREIGN KEY) — permintaan pemilik: fokus satu penyebab. Juga tidak menyentuh penyebab *hulu*
kelas #1 (token Buffer mati + kuota 429); itu operasional, bukan kode, dan sudah ditangani
terpisah (token baru 2026-11-06 + ledger/gate kuota). Yang diperbaiki di sini adalah hilangnya
informasi — gagal boleh terjadi, gagal tanpa alasan tidak.

## 3. Analisis konkurensi — "pecah di tenant berbayar kedua?"

### Temuan kode

| Hal | Nilai nyata | Berkas |
|---|---|---|
| Semaphore ffmpeg | `Semaphore(FFMPEG_MAX_CONCURRENT)`, env **tidak di-set → 1 permit** | `src/lib/render/ffmpegExec.ts:106-108` |
| Sifat semaphore | **in-memory, per proses Node** (modul singleton), bukan lintas-proses | `src/lib/render/ffmpegExec.ts:55-108` |
| Batas tunggu antrean ffmpeg | `FFMPEG_QUEUE_WAIT_MS` default **15 menit**, lewat itu → `FfmpegQueueError` "antrian ffmpeg penuh" | `src/lib/render/ffmpegExec.ts:191-192`, `:84-88` |
| Antrean HyperFrames | `HYPERFRAMES_QUEUE_ENABLED=1` di prod; `FairScheduler(HYPERFRAMES_MAX_CONCURRENT \|\| 1)` → **1 slot**, maks 8 job menunggu, queue-timeout 25 menit, lewat itu fallback ke ffmpeg | `src/lib/render/hyperframesClient.ts:27-35`, `src/lib/render/workerQueue.ts:93-153` |
| Generate di dalam request HTTP? | **Ya, sinkron** `await processProject(id)`; tidak ada `maxDuration`, tidak ada background/`after()` | `src/app/api/projects/[id]/process/route.ts:70`, `src/app/api/projects/[id]/retry/route.ts:92` |
| Batas nginx | `proxy_read_timeout 600s` / `proxy_send_timeout 600s` (**10 menit**) | `/etc/nginx/sites-available/aikonten.agustapstudio.com:15-16` |
| Timeout ffmpeg | `FFMPEG_TIMEOUT_MS=10800000` (**3 jam**) — jauh di atas batas nginx | `.env` prod |
| Kapasitas box app | 2 core, ~3,9 GB RAM; gate tambahan `RENDER_MIN_AVAILABLE_MB=500` | `src/lib/render/ffmpegExec.ts:169-174` |
| Durasi render tipikal | ~6 menit (worst ~22-25 menit) | `src/lib/render/hyperframesClient.ts:19-22` |

### Jawaban tegas: **BENAR, pecah di tenant berbayar kedua.**

Bukan soal uang (kredit dikembalikan di ketiga pemanggil `processProject`), tapi soal pengalaman:

1. Hanya ada **satu** `next-server` saat ini, jadi semaphore 1-permit itu *efektif* global hari
   ini — tapi hanya karena satu proses. Begitu ada instance kedua/cluster, "maks 1 render global"
   bohong dan dua ffmpeg bisa jalan bersamaan di box 2-core/4 GB.
2. Render tipikal ~6 menit. Tenant kedua yang klik "Buat Konten" bersamaan akan **menunggu di
   semaphore di dalam request HTTP-nya**. Request-nya dipotong nginx di **10 menit** → pelanggan
   dapat 504/spinner mati walau render sebenarnya masih jalan. Statusnya nanti berubah sendiri,
   tapi dari sisi pelanggan itu "gagal".
3. Tenant ketiga (atau dua render berurutan yang lambat) menembus batas tunggu 15 menit →
   **benar-benar gagal** dengan `antrian ffmpeg penuh (1 sedang berjalan), coba lagi nanti` +
   kredit kembali. Sudah terjadi 1x di jendela 7 hari ini, saat praktis baru 1 tenant aktif.
4. Jalur HyperFrames sudah lebih sopan (antre adil per tenant, 8 slot tunggu) tapi queue-timeout-nya
   25 menit — 2,5x lebih panjang dari batas nginx, jadi antreannya tetap tak pernah terlihat
   sukses oleh pelanggan yang menunggu di browser.

Kesimpulan: pembatas sebenarnya bukan jumlah slot, tapi **generate sinkron di dalam request HTTP
dengan plafon nginx 10 menit**.

### Pilihan perbaikan (untuk keputusan pemilik)

| Opsi | Isi | Biaya | Risiko |
|---|---|---|---|
| **A. Naikkan slot** `FFMPEG_MAX_CONCURRENT=2` | Satu env | ~0 | **Tinggi & salah sasaran.** Box 2-core/3,9 GB; audit 2026-11-05 mencatat app box ~0,9 fps. Dua ffmpeg = OOM / dua-duanya lambat. Tidak menyelesaikan plafon 10 menit nginx. |
| **B. Antre dgn batas waktu yang jujur** — `FFMPEG_QUEUE_WAIT_MS` ≈ 8 menit (di bawah nginx 600s), `HYPERFRAMES_QUEUE_TIMEOUT_MS` ≈ 8 menit, naikkan `proxy_read_timeout` jadi mis. 1800s | 2 env + 1 baris nginx, tanpa ubah kode | Rendah | Pelanggan tetap menunggu lama di spinner; kalau nginx dinaikkan, request menggantung ≤30 menit (pemakaian worker nginx naik). Menunda masalah, tidak menghapusnya. |
| **C. Generate jadi ASINKRON** — route `process`/`retry` cuma set `status='processing'` + enqueue, lalu balas 202; UI polling status yang sudah ada (`ProjectList` sudah menampilkan status/`errorMessage`) | ~1 hari: 1 tabel/kolom antrean + 1 runner (cron internal yang sudah ada bisa jadi pemanggil) + ubah 2 route + UI "Diproses" | Sedang | Perubahan alur nyata; perlu penanganan project yatim (proses mati saat `processing`). Tapi menghapus plafon nginx sepenuhnya & membuat antrean terlihat. |

**Rekomendasi: C, dengan B sebagai tambalan hari ini.** Set `FFMPEG_QUEUE_WAIT_MS`/
`HYPERFRAMES_QUEUE_TIMEOUT_MS` di bawah batas nginx sekarang (supaya pelanggan dapat pesan jelas +
kredit kembali, bukan 504 misterius), lalu pindahkan generate jadi asinkron sebelum tenant berbayar
kedua masuk. **Jangan** naikkan `FFMPEG_MAX_CONCURRENT` di box app — render berat memang sudah
diarahkan ke worker 4-core, bukan ke box ini.

*Catatan: Tugas 3 ini laporan saja, tidak ada kode konkurensi yang diubah di commit ini.*
