import { db } from "@/db";
import { users, plans, billingLog, creditTransactions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { _grantOnTx } from "./credits";
import { notifPaketAktif } from "./notify";
import { sendEmail, emailStrukPembayaran, emailAktivasiPaket } from "@/lib/email";

const MASA_AKTIF_HARI = 30;

// Proses pembayaran DIKONFIRMASI sukses (paket ATAU top-up) - SATU titik yang dipanggil kedua
// webhook (Tripay & Duitku) dan scripts/confirm-payment. Dibangun 2026-09-08, diperketat
// 2026-11-06 (billing-hardening P0):
//   ATOMIK  - flip status billingLog + update user (paket: plan/periode) + grant kredit semuanya
//             dalam SATU db.transaction(). Crash/throw di tengah -> rollback PENUH (tak ada
//             status=sukses tanpa kredit, tak ada kredit tanpa status).
//   EXACTLY-ONCE - kredit ber-kunci credit_transactions.ref_billing_id = billingLogId (lihat
//             _grantOnTx). Webhook retry (Tripay s/d 3x) / pemulihan TIDAK pernah double-credit,
//             dan TIDAK bergantung pada status "sukses" saja.
//   SELF-HEAL - tagihan "sukses tanpa kredit" (data lama / crash sebelum fix) bisa diperbaiki:
//             panggilan ulang meng-grant kredit yang hilang SEKALI (ref menjaga tak dobel).
// Efek jaringan (notif Telegram + email) DI LUAR transaksi & non-fatal.
export async function prosesPembayaranSukses(billingLogId: string): Promise<void> {
  const [log] = await db.select().from(billingLog).where(eq(billingLog.id, billingLogId));
  if (!log) throw new Error(`billingLog ${billingLogId} tidak ditemukan`);

  const now = new Date();
  const [user] = await db.select().from(users).where(eq(users.id, log.userId));

  // Siapkan data (read-only) SEBELUM transaksi - transaksi hanya menulis, cepat.
  let plan: typeof plans.$inferSelect | undefined;
  let periodeBerakhir: Date | undefined;
  let periodeMulai: Date | undefined;
  let kreditJumlah: number;
  let alasanKredit: string;
  let deskripsi: string;

  if (log.jenis === "topup") {
    kreditJumlah = log.kreditTopup ?? 0;
    alasanKredit = `top-up ${kreditJumlah} kredit`;
    deskripsi = `Top-up ${kreditJumlah} kredit`;
  } else {
    if (!log.planId) throw new Error(`billingLog ${billingLogId} bukan tagihan paket (planId kosong)`);
    [plan] = await db.select().from(plans).where(eq(plans.id, log.planId));
    if (!plan) throw new Error(`plan ${log.planId} tidak ditemukan`);
    kreditJumlah = plan.kreditBulanan;
    alasanKredit = "isi_ulang_bulanan";
    deskripsi = `Paket ${plan.nama}`;
    // (2026-10-07, #1 Perpanjangan) Paket SAMA & masih aktif -> TAMBAH dari sisa periode biar
    // hari sisa tak hangus saat perpanjang lebih awal. Paket baru / lewat = mulai dari sekarang.
    const stillActive = !!(user && user.planId === plan.id && user.periodeBerakhir && user.periodeBerakhir.getTime() > now.getTime());
    const base = stillActive ? user!.periodeBerakhir! : now;
    periodeBerakhir = new Date(base.getTime() + MASA_AKTIF_HARI * 24 * 60 * 60 * 1000);
    periodeMulai = stillActive ? (user!.periodeMulai ?? now) : now;
  }

  // TRANSAKSI TUNGGAL (sinkron, better-sqlite3). Idempoten: kalau kredit utk tagihan ini sudah
  // pernah di-grant (ref ada) -> hanya pastikan status sukses, JANGAN ulang plan/periode/kredit
  // (mencegah perpanjangan periode ganda saat webhook dobel).
  const granted = db.transaction((tx) => {
    tx.update(billingLog).set({ status: "sukses" }).where(eq(billingLog.id, billingLogId)).run();
    const sudah = tx.select({ id: creditTransactions.id }).from(creditTransactions)
      .where(eq(creditTransactions.refBillingId, billingLogId)).all();
    if (sudah.length > 0) return false;
    if (plan && periodeBerakhir) {
      tx.update(users).set({
        planId: plan.id,
        status: "aktif",
        periodeMulai,
        periodeBerakhir,
        langgananDibatalkan: false,
      }).where(eq(users.id, log.userId)).run();
    }
    _grantOnTx(tx, log.userId, kreditJumlah, alasanKredit, billingLogId);
    return true;
  });

  if (!granted || !user) return; // dobel/pemulihan-tanpa-kredit -> tak ada efek samping ulang

  // Non-fatal: notif owner + email pelanggan (struk + aktivasi). Kegagalan tak membatalkan apa pun.
  if (plan && periodeBerakhir) { try { await notifPaketAktif(user, plan.nama, periodeBerakhir); } catch {} }
  try { await sendEmail(emailStrukPembayaran(user.email, deskripsi, log.jumlahBayarIdr)); } catch {}
  if (plan && periodeBerakhir) { try { await sendEmail(emailAktivasiPaket(user.email, plan.nama, periodeBerakhir)); } catch {} }
}

// Kompat: nama lama khusus paket (dipakai scripts/confirm-payment.ts). Teruskan ke jalur tunggal.
export async function aktivasiPaketSetelahBayar(billingLogId: string): Promise<void> {
  return prosesPembayaranSukses(billingLogId);
}
