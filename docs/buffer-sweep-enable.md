# Mengaktifkan Buffer Sweep dengan aman (feat/buffer-quota-saver)

Sweep = rekonsiliasi publish Buffer berbasis DB (flag `BUFFER_SWEEP_ENABLED`, default OFF).
Infra sudah ada: route `cron/publish-sweep`, timer `scripts/cron/kontenpilot-publish-sweep.timer`
(tiap 20 menit), tabel `buffer_pending_checks` (migrasi `scripts/migrate-publish-ledger.ts`).

## Apa yang BERUBAH saat sweep ON (vs jalur lama OFF)

Jalur LAMA (OFF, sekarang), per publish sukses:
- Deteksi duplikat: `checkAndHandleDuplicate` poll 1x ~180 dtk -> 1 call `duplicateCheck` per posting.
- Verifikasi: `verifyPublishSucceeded` poll s/d 2x (~5 & ~15 mnt) -> 1-2 call `verify` per posting
  (Instagram di-skip). Per posting non-IG = +2-3 call.

Jalur SWEEP (ON):
- Saat publish sukses: post dicatat sbg PENDING di DB (`buffer_pending_checks`), TANPA poll per-post.
- Timer sweep (20 mnt): untuk tiap channel yang punya pending -> **1 query `posts`** (`listRecentPosts`)
  memverifikasi status SEMUA pending channel itu sekaligus + deteksi duplikat (post lain, teks identik,
  bukan milik kita). Cocok HANYA via `platformPostId` + `knownPostIds` -> tak pernah hapus post sendiri.
- Hasil: dup+verify per-posting (per-post, 2-3 call) -> **1 call `sweep` per channel per siklus**,
  di-batch. Verifikasi lama TIDAK dipanggil utk jalur yg sudah dicatat (tak ada post tanpa verifikasi).

Keduanya MUTUALLY EXCLUSIVE (buffer.ts cek `!sweepEnabled()`), jadi tak ada kerja ganda.

## Prasyarat aman sebelum menyalakan
1. Migrasi ledger sudah jalan (`buffer_call_ledger`, `buffer_token_state`, `buffer_pending_checks`).
2. Timer sweep terpasang & aktif: `kontenpilot-publish-sweep.timer` (kalau belum, pending TAK PERNAH
   direkonsiliasi -> post tak terverifikasi). Uji dulu READ-ONLY tanpa menyalakan flag:
   `POST cron/publish-sweep?dryRun=1` (listRecentPosts + rekonsiliasi saja, tanpa delete/notif/cooldown).
3. Baru set `BUFFER_SWEEP_ENABLED=1` + restart app + pastikan timer sweep jalan.

## Rollback
Hapus `BUFFER_SWEEP_ENABLED` (atau =0) + restart -> jalur verifikasi lama kembali. Pending tersisa di DB
aman (sweep berikutnya/none; tak merusak data). Timer sweep boleh dibiarkan (no-op saat flag OFF).
