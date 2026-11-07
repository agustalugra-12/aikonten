import { sendTelegramNotification } from "@/lib/publish/telegram";

// Notifikasi transaksional billing (2026-10-11, #2). Dikirim ke OWNER (Agus) lewat channel
// Telegram yang SUDAH ada (sendTelegramNotification) - saas belum punya channel ke pelanggan
// (tak ada Fonnte/email terkonfigurasi; notif WA ke pelanggan menyusul begitu token Fonnte
// diputuskan). Semua helper SWALLOW error (log saja) supaya kegagalan notif TIDAK pernah
// menggagalkan checkout/aktivasi/cron - notif itu jaring pengaman, bukan jalur kritis.
const APP_BASE = process.env.APP_BASE_URL ?? "https://aikonten.agustapstudio.com";
const rupiah = (n: number) => "Rp" + n.toLocaleString("id-ID");
const tanggal = (d: Date) => d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });

type Pelanggan = { nama?: string | null; namaBisnis?: string | null; email: string; nomorWa?: string | null };
function labelPelanggan(u: Pelanggan): string {
  const nama = u.nama || u.namaBisnis || u.email;
  return `${nama} (${u.email})` + (u.nomorWa ? ` · WA ${u.nomorWa}` : "");
}
async function kirim(pesan: string): Promise<void> {
  try {
    await sendTelegramNotification(pesan);
  } catch (e) {
    console.error("[notify] gagal kirim notif transaksional:", e);
  }
}

// Order manual masuk (BCA) - Agus perlu cek mutasi lalu konfirmasi di Master. Hanya dipakai
// di jalur manual (Duitku belum tersambung); begitu gateway live, webhook yang urus.
export function notifOrderPending(u: Pelanggan, deskripsi: string, jumlahIdr: number): Promise<void> {
  return kirim(
    `\u{1F4B0} <b>Order baru — tunggu konfirmasi bayar</b>\n` +
    `${labelPelanggan(u)}\n` +
    `${deskripsi} — <b>${rupiah(jumlahIdr)}</b>\n\n` +
    `Cek mutasi BCA, lalu konfirmasi di Master:\n${APP_BASE}/master`,
  );
}

// (2026-11-07) Transaksi gateway BERHASIL DIBUAT - pelanggan diarahkan ke halaman bayar.
// Sebelumnya jalur gateway SAMA SEKALI tak memberi notifikasi (notifOrderPending hanya
// dipanggil di cabang manual), jadi order Tripay masuk tanpa jejak di Telegram.
export function notifPembayaranDibuat(
  u: Pelanggan,
  deskripsi: string,
  jumlahIdr: number,
  billingLogId: string,
  gateway: string,
  gatewayRef?: string | null,
): Promise<void> {
  return kirim(
    `\u{1F6D2} <b>Order baru — menunggu pembayaran</b>\n` +
    `${labelPelanggan(u)}\n` +
    `${deskripsi} — <b>${rupiah(jumlahIdr)}</b>\n` +
    `No. pesanan: <code>${billingLogId}</code>\n` +
    `Gateway: ${gateway}${gatewayRef ? ` · ref ${gatewayRef}` : ""}`,
  );
}

// Paket diaktifkan (dipicu konfirmasi manual admin ATAU webhook gateway nanti - 1 titik).
export function notifPaketAktif(u: Pelanggan, namaPaket: string, berakhir: Date): Promise<void> {
  return kirim(
    `✅ <b>Paket aktif</b>\n` +
    `${labelPelanggan(u)}\n` +
    `Paket ${namaPaket} — berlaku s/d ${tanggal(berakhir)}`,
  );
}

// (2026-11-07) Pembayaran LUNAS untuk tagihan yang BUKAN paket (top-up kredit) - dulu top-up
// sukses tak pernah terlihat di Telegram (notifPaketAktif hanya jalan kalau ada plan).
export function notifPembayaranSukses(u: Pelanggan, deskripsi: string, jumlahIdr: number, billingLogId: string): Promise<void> {
  return kirim(
    `\u{1F4B5} <b>Pembayaran lunas</b>\n` +
    `${labelPelanggan(u)}\n` +
    `${deskripsi} — <b>${rupiah(jumlahIdr)}</b>\n` +
    `No. pesanan: <code>${billingLogId}</code>`,
  );
}

// (2026-11-07) Pembayaran GAGAL/kadaluarsa (webhook gateway atau hasil rekonsiliasi).
export function notifPembayaranGagal(u: Pelanggan | null, deskripsi: string, jumlahIdr: number, billingLogId: string, alasan: string): Promise<void> {
  return kirim(
    `❌ <b>Pembayaran gagal/kadaluarsa</b>\n` +
    `${u ? labelPelanggan(u) : "(pelanggan tak ditemukan)"}\n` +
    `${deskripsi} — <b>${rupiah(jumlahIdr)}</b>\n` +
    `No. pesanan: <code>${billingLogId}</code>\n` +
    `Alasan: ${alasan}`,
  );
}

// (2026-11-07) Laporan cron rekonsiliasi. `lunasTakBerkredit` = PALING GENTING: Tripay bilang
// PAID tapi tagihan kita masih pending (webhook tak sampai) -> harus dikonfirmasi manual.
// `menggantung` = masih pending melewati ambang. Kirim HANYA kalau ada isinya (jangan spam).
export function notifRekonsiliasi(lunasTakBerkredit: string[], menggantung: string[]): Promise<void> {
  if (lunasTakBerkredit.length === 0 && menggantung.length === 0) return Promise.resolve();
  const bagian: string[] = [];
  if (lunasTakBerkredit.length) {
    bagian.push(
      `\u{1F6A8} <b>LUNAS di Tripay tapi belum jadi kredit (${lunasTakBerkredit.length})</b>\n` +
      lunasTakBerkredit.map((s) => `• ${s}`).join("\n") +
      `\n\nKonfirmasi manual di Master:\n${APP_BASE}/master`,
    );
  }
  if (menggantung.length) {
    bagian.push(`⏳ Masih menggantung (${menggantung.length}):\n` + menggantung.map((s) => `• ${s}`).join("\n"));
  }
  return kirim(`<b>Rekonsiliasi pembayaran</b>\n\n` + bagian.join("\n\n"));
}

// Ringkasan transisi expiry harian dari cron. Kirim HANYA kalau ada yang pindah status
// (jangan spam chat tiap hari kalau tak ada perubahan).
export function notifExpiry(masaTenggang: string[], terbatas: string[]): Promise<void> {
  if (masaTenggang.length === 0 && terbatas.length === 0) return Promise.resolve();
  const bagian: string[] = [];
  if (masaTenggang.length) bagian.push(`⚠️ Masuk masa tenggang (${masaTenggang.length}):\n` + masaTenggang.map((s) => `• ${s}`).join("\n"));
  if (terbatas.length) bagian.push(`\u{1F512} Jadi terbatas (${terbatas.length}):\n` + terbatas.map((s) => `• ${s}`).join("\n"));
  return kirim(`<b>Status langganan berubah hari ini</b>\n\n` + bagian.join("\n\n"));
}
