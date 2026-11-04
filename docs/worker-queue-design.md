# Rancangan antrean worker — Tahap 3 (2026-11-04, PRE-Gerbang 2, BELUM diwire)

Sasaran: (3) waktu antre jangan menghabiskan deadline render; render timeout jangan terus pegang slot.
(4) retry terbatas + kuota per tenant. Helper murni di `src/lib/render/workerQueue.ts` (teruji mock,
**belum dipanggil** `processProject` — nol dampak prod). Wiring = pekerjaan PASCA-Gerbang 2.

## (3a) Anggaran deadline terbagi — `splitRenderBudget`
Masalah: deadline 28min dihitung sejak submit, termasuk waktu antre. Render yang mulai telat bisa doomed.
Rancangan: catat `queueWaitedMs` (sejak enqueue sampai dapat slot). Sebelum mulai render:
`remaining = totalDeadlineMs - queueWaitedMs`. Kalau `remaining < minRenderMs` → **jangan mulai**
(`proceed=false`) → langsung fallback ffmpeg (hemat slot + pasti-gagal dihindari). Kalau cukup →
`renderDeadlineMs = remaining` (deadline render = sisa, bukan 28min penuh lagi).

## (3b) Slot dilepas saat timeout — `runWithSlotTimeout`
Masalah: render menggantung baru lepas slot pada timeout worker 15min. Rancangan sisi-klien: bungkus
panggilan worker dengan timeout KERAS `slotTimeoutMs` (≤ renderDeadlineMs) + `AbortController`. Saat lewat:
abort request + **panggil `onRelease()` segera** (lepas kuota/slot logis) + return `{ok:false, reason:"timeout"}`.
Render berikut tak menunggu 15min. (Worker tetap punya timeout sendiri; ini lapis klien agar slot logis bebas.)

## (4a) Retry terbatas — `nextRetryDelayMs`
Hanya untuk kegagalan **transient** (tunnel putus sesaat, 502/ECONNRESET), BUKAN timeout render (mahal).
Exponential backoff `baseMs * 2^attempt`, di-cap `capMs`, maksimum `maxAttempts`. Habis → `null` → fallback ffmpeg.
Default usul: `maxAttempts=2`, `baseMs=1500`, `capMs=8000`. Timeout/5xx-render → **tanpa retry** (langsung fallback).

## (4b) Kuota per tenant — `TenantQuota`
Masalah: worker serial dimonopoli satu tenant. Rancangan limiter in-memory (per instance app):
- `maxConcurrentPerTenant` (usul 1) — 1 render berjalan per tenant; kelebihan ditolak → fallback, bukan antre lama.
- `maxGlobalQueue` (usul 3–4) — batas total render in-flight; penuh → `global_full` → fallback cepat.
`tryAcquire(tenantId)` saat submit; `release(tenantId)` di `finally` (sukses/gagal/timeout). Anti-starvation:
karena concurrent-per-tenant dibatasi, tak ada tenant yang menahan seluruh antrean.

## Interaksi dengan fallback ffmpeg
Semua jalur "tak bisa/ tak layak render worker" bermuara ke fallback ffmpeg yang SUDAH ada di `processProject`:
`proceed=false` (budget habis), `reason:"timeout"`/`"error"`, retry habis (`null`), kuota penuh
(`tenant_limit`/`global_full`). Fallback = perilaku aman existing (observe/engine ffmpeg tetap jalan).

## Rencana wiring PASCA-Gerbang 2 (belum dikerjakan)
1. `hyperframesClient`: terima `tenantId` + `enqueuedAt`; `TenantQuota.tryAcquire` sebelum POST; hitung
   `queueWaitedMs`; `splitRenderBudget`; `runWithSlotTimeout(renderDeadlineMs)`; retry transient; `release` di finally.
2. `processProject`: map kegagalan → fallback ffmpeg (sudah ada); catat sebab ke `autoFixLog`.
3. Worker `server.mjs` (opsional, perlu akses VPS + Gerbang): turunkan `RENDER_TIMEOUT_MS` agar < slot klien,
   atau tambah endpoint `/cancel`. **Perlu persetujuan — mengubah VPS.**

## Risiko
- Limiter in-memory per-instance (bukan lintas-instance). Cukup krn app saat ini 1 instance; kalau scale-out
  perlu store bersama (Redis) — dicatat, bukan sekarang.
- Slot klien dilepas saat timeout TAPI worker mungkin masih sibuk render lama (serial) → render berikut masih
  bisa antre di worker. Mitigasi penuh butuh `/cancel` di worker (perlu Gerbang + akses VPS).
