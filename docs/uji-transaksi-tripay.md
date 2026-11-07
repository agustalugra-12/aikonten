# Uji transaksi Tripay nyata — top-up Rp49.000

Tujuan: membuktikan jalur uang ujung-ke-ujung (checkout → bayar → webhook → kredit masuk →
notifikasi Telegram) dengan **uang sungguhan** senilai Rp49.000, karena sampai sekarang
`billing_log` belum pernah mencatat satu pun transaksi gateway (2 baris lama, `gateway_ref`
kosong). Pakai paket top-up yang sudah ada: `topup10` = **10 kredit / Rp49.000**
(`src/lib/billing/topupPacks.ts`).

**Dokumen ini BELUM dijalankan.** Dijalankan oleh owner (Agus), bukan agen.

Dipilih top-up (bukan paket) karena top-up hanya **menambah saldo kredit** — tidak mengubah
`plan_id` / `periode_berakhir` akun, jadi kalau uji gagal tidak ada langganan yang perlu
dibereskan.

---

## 0. Prasyarat (cek dulu, 2 menit)

Semua perintah dijalankan di VPS: `ssh admin@202.10.41.72`.

```bash
cd /home/admin/kontenpilot-saas
grep -E '^(PAYMENT_PROVIDER|TRIPAY_MODE)=' .env          # harus tripay + production
grep -cE '^(TRIPAY_API_KEY|TRIPAY_MERCHANT_CODE|TRIPAY_PRIVATE_KEY)=.+' .env   # harus 3
systemctl is-active aikonten-saas                         # harus active
curl -s localhost:3200/api/health                          # {"ok":true,...}
```

Dashboard Tripay → Callback URL **wajib** `https://aikonten.agustapstudio.com/api/webhooks/tripay`
(ini satu-satunya hal yang bikin kredit tak pernah masuk kalau salah). Kalau Tripay punya
whitelist IP callback, pastikan IP VPS ada.

Catat saldo awal akun yang dipakai (pakai akun pelanggan asli/akun uji milik sendiri, **bukan**
akun `unlimited`):

```bash
sqlite3 -readonly data/kontenpilot.db \
  "SELECT id, email, saldo_kredit, plan_id FROM users WHERE email='EMAIL_UJI';"
```

Catat `saldo_kredit` **sebelum** → sebut `SALDO_AWAL`.

Siapkan 2 jendela log sebelum mulai:

```bash
# terminal A - log aplikasi (webhook & notif muncul di sini)
journalctl -u aikonten-saas -f
```

---

## 1. Checkout (buat order)

1. Buka `https://aikonten.agustapstudio.com/kredit` sebagai akun uji (login dulu).
2. Di bagian **Top-up kredit**, klik paket **10 konten — Rp49.000**.
3. Muncul pilihan metode pembayaran (dari `GET /api/account/payment-methods?amount=49000`).
   Pilih **QRIS** (paling cepat & fee-nya jelas).
4. Klik bayar → browser diarahkan ke halaman checkout Tripay (`checkout_url`).

**Yang harus terlihat:**

| Di mana | Harapan |
|---|---|
| Browser | Pindah ke domain `tripay.co.id` dengan nominal Rp49.000 (+ fee channel) |
| Telegram owner | Pesan **"🛒 Order baru — menunggu pembayaran"** berisi email pelanggan, `Top-up 10 konten — Rp49.000`, `No. pesanan: bill_…`, `Gateway: Tripay · ref T…` |
| DB | baris baru `pending` **dengan** `gateway_ref` terisi |

```bash
sqlite3 -readonly data/kontenpilot.db \
  "SELECT id, jenis, kredit_topup, jumlah_bayar_idr, status, gateway_ref,
          datetime(created_at,'unixepoch','localtime')
     FROM billing_log ORDER BY created_at DESC LIMIT 3;"
```

Catat `id` baris itu → sebut **`BILL`**, dan `gateway_ref` → **`REF`**.

> Kalau `gateway_ref` KOSONG atau tidak ada baris baru: `createTransaction` gagal → cari di
> terminal A `[topup] gagal buat transaksi Tripay:` lalu baca pesan Tripay-nya (kredensial,
> channel tak aktif, amount di bawah minimum channel). Order ini mati; lanjut ke §5.

---

## 2. Bayar Rp49.000

Scan QRIS dari halaman Tripay dengan aplikasi bank/e-wallet, bayar **sesuai nominal yang
tertulis di halaman Tripay** (nominal + fee; jangan dibulatkan sendiri — nominal yang beda
bikin Tripay tak menandai PAID).

Setelah pembayaran sukses di aplikasi bank, Tripay mengarahkan balik ke
`/kredit?topup=selesai`.

---

## 3. Webhook → kredit masuk (≤ 1 menit)

**Yang harus terlihat, berurutan:**

| Di mana | Harapan |
|---|---|
| Terminal A | request `POST /api/webhooks/tripay` dengan status 200 |
| Telegram owner | **"💵 Pembayaran lunas"** — `Top-up 10 kredit — Rp49.000`, `No. pesanan: BILL` |
| Email pelanggan | struk pembayaran (`emailStrukPembayaran`) — kalau SMTP aktif |
| UI `/kredit` | saldo = `SALDO_AWAL + 10`, dan baris riwayat `top-up 10 kredit` |

Verifikasi di DB (tiga hal sekaligus — status, kredit, dan kunci idempotensi):

```bash
sqlite3 -readonly data/kontenpilot.db "
  SELECT status, gateway_ref FROM billing_log WHERE id='BILL';
  SELECT saldo_kredit FROM users WHERE email='EMAIL_UJI';
  SELECT id, jumlah, alasan, saldo_setelah, ref_billing_id
    FROM credit_transactions WHERE ref_billing_id='BILL';"
```

Lulus kalau: `status='sukses'`, `saldo_kredit = SALDO_AWAL + 10`, dan ada **tepat satu** baris
`credit_transactions` dengan `ref_billing_id='BILL'`, `jumlah=10`.

Satu baris itu yang menjamin webhook retry Tripay (s/d 3×) tidak pernah menggandakan kredit.
Kalau mau sekalian menguji itu: tunggu beberapa menit dan pastikan jumlah baris tetap 1.

---

## 4. Kalau kredit TIDAK masuk — urutan periksa

Kerjakan dari atas; berhenti di langkah yang menjawab.

1. **Webhook sampai tidak?**
   ```bash
   journalctl -u aikonten-saas --since "20 min ago" | grep -i "webhooks/tripay"
   ```
   - Tidak ada sama sekali → Tripay tidak memanggil kita: cek **Callback URL** & riwayat
     callback di dashboard Tripay (Tripay menampilkan response tiap percobaan), lalu cek nginx:
     `sudo tail -50 /var/log/nginx/access.log | grep webhooks`.
   - Ada tapi **401** → `TRIPAY_PRIVATE_KEY` di `.env` bukan milik merchant yang sama
     (signature HMAC tak cocok). Perbaiki `.env` → `sudo systemctl restart aikonten-saas` →
     minta Tripay kirim ulang callback dari dashboard.
   - Ada tapi **404** → `merchant_ref` tak ketemu: bandingkan `merchant_ref` di payload Tripay
     dengan `BILL`.
   - Ada tapi **500** → baca stack trace di `journalctl`; tagihan tetap `pending`, kredit belum
     bergerak (aktivasi atomik: tak ada status sukses tanpa kredit).

2. **Status di Tripay sendiri?** Cek di dashboard Tripay detail transaksi `REF` — `UNPAID`
   berarti uang belum terhitung (nominal beda / pembayaran batal), bukan masalah sistem kita.

3. **Jalankan rekonsiliasi manual** (ini juga sekalian menguji cron baru):
   ```bash
   cd /home/admin/kontenpilot-saas
   ./scripts/cron/call-saas-endpoint.sh /api/cron/reconcile-billing
   ```
   Balasannya JSON: `lunas_tapi_pending` > 0 berarti **Tripay bilang PAID tapi tagihan kita
   masih pending** → webhook-nya memang tak sampai. Owner akan dapat Telegram
   **"🚨 LUNAS di Tripay tapi belum jadi kredit"**.
   Cron ini **tidak** memberi kredit sendiri (sengaja — aktivasi tetap satu jalur terverifikasi).

4. **Beri kredit manual** setelah yakin uangnya masuk (lihat mutasi Tripay):
   - lewat UI: `/master` → pelanggan → konfirmasi pembayaran, **atau**
   - lewat script: `npx tsx scripts/confirm-payment.ts BILL`
     (memanggil `prosesPembayaranSukses` yang sama, idempoten — aman walau webhook menyusul).
   Lalu ulangi verifikasi §3.

5. **Log unit cron** (kalau timer sudah dipasang):
   ```bash
   journalctl -u aikonten-saas-reconcile-billing -n 50
   systemctl list-timers | grep reconcile
   ```

---

## 5. Merapikan kalau uji gagal

- **Order mati / tak dibayar** (`status='pending'`, Tripay `UNPAID`/`EXPIRED`): tak perlu apa-apa.
  Cron rekonsiliasi akan menandainya `gagal` sendiri begitu Tripay bilang EXPIRED/FAILED, dan
  tidak ada kredit/uang yang bergerak. Mau manual:
  ```bash
  # HATI-HATI: tulis ke DB produksi. Hanya untuk BILL milik uji ini, hanya kalau masih pending.
  sqlite3 data/kontenpilot.db \
    "UPDATE billing_log SET status='gagal' WHERE id='BILL' AND status='pending';"
  ```
- **Uang terkirim tapi uji dibatalkan**: jangan hapus `billing_log` — itu catatan uang masuk
  sungguhan (dan dipakai `/api/invoice/BILL`). Biarkan `sukses` + 10 kredit; kalau kredit uji
  ingin ditarik lagi, catat sebagai penyesuaian manual (jangan `DELETE` dari
  `credit_transactions` — `ref_billing_id` adalah kunci anti-dobel; menghapusnya membuat
  pembayaran yang sama bisa meng-grant kredit lagi).
- **Refund**: lakukan dari dashboard Tripay. Kalau statusnya jadi `REFUND`, cron/webhook akan
  menandai tagihan `gagal`; kredit yang sudah masuk **tidak** otomatis ditarik — kurangi manual
  dari Master kalau perlu.
- Backup sebelum menyentuh DB: `/home/admin/backups/kontenpilot/` (harian 02:30), atau
  `sqlite3 data/kontenpilot.db ".backup /tmp/pra-uji.db"`.

---

## 6. Setelah uji lulus

1. Catat di `docs/RUNBOOK_SAAS.md` bahwa Tripay production sudah diuji (tanggal + `BILL`).
2. Pasang timer rekonsiliasi (berkas sudah ada di repo, belum terpasang):
   ```bash
   sudo cp scripts/cron/aikonten-saas-reconcile-billing.{service,timer} /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now aikonten-saas-reconcile-billing.timer
   ```
3. Simpan screenshot kwitansi `https://aikonten.agustapstudio.com/api/invoice/BILL`.
