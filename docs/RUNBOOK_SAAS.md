# Runbook — AI Konten SaaS (KontenPilot)

Operasional & go-live untuk aplikasi SaaS multi-tenant. Dokumen ini ringkas; detail ada di kode.

## Arsitektur & akses
- **App**: `aikonten.agustapstudio.com` → nginx `proxy_pass 127.0.0.1:3200` → Next.js (branch `saas-multitenant`).
- **Situs marketing**: `agustapstudio.com` → statis (`/var/www/agustapstudio`). Tidak ada backend di sini.
- **VPS**: `admin@202.10.41.72` (sudo NOPASSWD). Dir: `/home/admin/kontenpilot-saas`. Node: `/home/admin/.nvm/versions/node/v20.20.2/bin`.
- **systemd service**: `aikonten-saas.service` (port 3200, User=root, `npm start`).
- **DB**: SQLite `data/kontenpilot.db` (WAL). Perubahan schema: `sqlite3 ALTER` MANUAL — **JANGAN** `drizzle-kit migrate` (desync, meng-recreate semua tabel).

## Deploy
```
# edit lokal → scp ke /tmp → patch/cp ke src → build (guard rollback) → restart
cd /home/admin/kontenpilot-saas
npm run build && sudo systemctl restart aikonten-saas
```
Selalu build dulu; kalau gagal, restore file lama sebelum restart (jangan restart dengan build gagal).

## Prosedur perubahan schema DB (manual, ber-guard)
Repo ini **TIDAK** memakai `drizzle-kit migrate` (jurnal `__drizzle_migrations` rusak + histori snapshot tertinggal jauh dari `schema.ts` — migrate akan gagal / meng-recreate tabel). Histori migrasi Drizzle **belum** diperbaiki; itu masalah lama terpisah. Perubahan schema diterapkan MANUAL + ber-guard (idempoten), per server:
1. Update `src/db/schema.ts` (+ `src/types/index.ts` kalau tipe dipakai di UI) supaya kode tahu kolom/tabel baru.
2. Tulis ALTER **ber-guard**: cek `PRAGMA table_info(<tabel>)` dulu, `ADD` hanya kalau belum ada (SQLite tak punya `ADD COLUMN IF NOT EXISTS`, jadi ALTER mentah TIDAK idempoten).
3. Jalankan di **tiap** server (A & B). Contoh kolom `brands.brand_kit` (Phase 2 Font Studio): `npx tsx scripts/add-brand-kit-column.ts` — idempoten, aman diulang, "SKIP" kalau kolom sudah ada.
4. Backup DB dulu utk perubahan besar. **JANGAN** `drizzle-kit migrate`.

## Env (.env server — nama saja, bukan nilai)
| Var | Guna |
|---|---|
| `SESSION_SECRET` | tanda tangan JWT sesi (44 char) |
| `ADMIN_EMAILS` | daftar email admin (koma) → akses Master |
| `APP_BASE_URL` | `https://aikonten.agustapstudio.com` (callback/return gateway) |
| `DUITKU_MERCHANT_CODE` / `DUITKU_API_KEY` / `DUITKU_ENV` | gateway Duitku (sandbox/production) |
| `TRIPAY_PRIVATE_KEY` | verifikasi webhook Tripay (kosong = webhook nolak 401) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | notif owner (transaksi, expiry, uptime, audit hapus) |
| `CRON_SECRET` | auth endpoint cron internal (X-Cron-Key) |

## Pembayaran
- **Manual BCA** (default saat gateway belum aktif): `duitkuConfigured()=false` → tagihan `pending` → owner konfirmasi di Master → `aktivasiPaketSetelahBayar` (idempoten). Rekening: BCA 6110330411 a.n. Lugra Agusta.
- **Duitku** (sandbox AKTIF): flow = `/api/account/payment-methods` (pilih metode, WAJIB) → `select-plan`/`topup` dgn `paymentMethod` → redirect `paymentUrl` → webhook `/api/webhooks/payment` (verifikasi signature MD5).
- **Tripay** (siap, key kosong): webhook `/api/webhooks/tripay` (HMAC-SHA256 body mentah). Belum ada createTransaction (webhook-only).
- **Kwitansi**: `GET /api/invoice/[id]` (HTML printable; pemilik/admin).

### Go-live Duitku production
1. `.env`: `DUITKU_MERCHANT_CODE`/`DUITKU_API_KEY` production, `DUITKU_ENV=production`.
2. `sudo systemctl restart aikonten-saas`.
3. Dashboard Duitku: set Callback URL = `https://aikonten.agustapstudio.com/api/webhooks/payment`.
4. Tes 1 transaksi nominal kecil.

### Aktifkan Tripay
1. `.env`: `TRIPAY_PRIVATE_KEY=<dari dashboard>` → restart.
2. Dashboard Tripay: Callback URL = `https://aikonten.agustapstudio.com/api/webhooks/tripay`; whitelist IP kita.

## Cron / timer (systemd, salinan unit di `scripts/cron/`)
| Unit | Jadwal | Fungsi |
|---|---|---|
| `aikonten-saas-check-expiry` | 03:00 | transisi status langganan (aktif→masa_tenggang→terbatas) + notif |
| backup (`/home/admin/backups/kontenpilot/backup.sh`) | 02:30 | backup DB harian (gzip, simpan 30, cek integritas) |
| `aikonten-saas-health-monitor` | tiap 5 mnt | cek `/api/health`, alert Telegram saat status berubah |

## Monitoring
- `GET /api/health` → `{ok,db,time}` (publik).
- Self-monitor timer di atas: nangkap app crash / DB mati / 503. **Keterbatasan**: outage jaringan-keluar total tak bisa kirim alert (Telegram ikut mati) → pertimbangkan monitor eksternal (UptimeRobot/BetterStack) ping `/api/health`.
- Kejadian 2026-10-23: VPS sempat kehilangan konektivitas keluar ~13 menit (infra hosting).

## Keamanan
- **2FA admin** (opt-in, default off): aktifkan di Master → "Keamanan 2FA". Setelah aktif, login admin minta kode TOTP (authenticator). Sesi penuh hanya terbit setelah 2FA.
- **Rate-limit**: login & signup (5/15mnt per IP+email), 2FA (5/10mnt).
- **Audit log**: semua aksi admin tercatat (`audit_log`), lihat panel "Log aktivitas admin" di Master.
- **PDP**: export & hapus (anonymize) data pelanggan dari Master.

## Testing
`npm test` → `tests/critical.ts` (TOTP, signature Duitku/Tripay, rate-limit). Murni fungsi, tak sentuh DB.

## Dependency (npm audit 2026-10-23)
23 kerentanan, mayoritas transitif (`undici` via Next.js, `uuid` via `exceljs`), sebagian besar tak relevan untuk server-side ini. **Jangan** `npm audit fix --force` (breaking). Rencana aman: upgrade Next.js (bawa undici ter-patch) sebagai perubahan terencana + tes build.

## Backup & restore
- Lokasi: `/home/admin/backups/kontenpilot/kontenpilot-*.db.gz` (30 terbaru).
- Restore: `gunzip -c <file>.gz > restore.db`, verifikasi `PRAGMA integrity_check`, stop service, ganti `data/kontenpilot.db`, start.
- Off-site backup: DIBATALKAN permanen (keputusan Agus).

## Aturan operasional render (2026-10-24, Fase nol-biaya)
**SATU proses render saja** — semua render (manual + semua cron) masuk ke proses SaaS `:3200`; pengaman concurrency = satu `globalSemaphore` (permits=1) di proses itu. Pengaman ini **in-memory, tidak lintas-proses**. Maka:
- JANGAN jalankan script render mandiri (`scripts/regen-narration.ts`, `scripts/verify-*.ts`, atau apa pun yang mengimpor `renderFinalVideo`/`runFfmpeg`) saat produksi aktif — proses tsx terpisah punya semaphore sendiri → bisa 2 render paralel → OOM.
- JANGAN hidupkan aplikasi render kedua / `kontenpilot-backend :3100` — biarkan pensiun. Cron render semua menuju `:3200` (lihat `call-endpoint.sh`).
- Pantau onboarding bertahap dengan `scripts/render-watch.sh` (read-only).
- Pengaman lintas-proses (mis. `flock`) BELUM dibuat (sengaja) — cukup jaga operasional 1 proses render. Dibuat nanti bila perlu >1 proses.
