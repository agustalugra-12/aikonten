// Konfirmasi pembayaran MANUAL (2026-09-08, Fase 1 Alur A) - pengganti sementara webhook
// payment gateway asli yang belum disambungkan ("kredensial disambungkan di akhir").
// Jalankan Agus SENDIRI setelah verifikasi pembayaran masuk secara manual (transfer/cek
// mutasi rekening) - BUKAN dipicu otomatis oleh apa pun, dan SENGAJA bukan endpoint HTTP
// publik (tidak ada jalan pintas kredit gratis dari luar). Begitu payment gateway
// tersambung, webhook-nya cukup panggil aktivasiPaketSetelahBayar() yang sama - script
// ini jadi tidak diperlukan lagi (tapi aman dibiarkan ada utk override manual/darurat).
//
// Jalankan: npx tsx scripts/confirm-payment.ts <billingLogId>
import { db } from "../src/db";
import { billingLog, users } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { aktivasiPaketSetelahBayar } from "../src/lib/billing/activation";

async function main() {
  const billingLogId = process.argv[2];
  if (!billingLogId) {
    console.error("Usage: npx tsx scripts/confirm-payment.ts <billingLogId>");
    process.exit(1);
  }

  const [log] = await db.select().from(billingLog).where(eq(billingLog.id, billingLogId));
  if (!log) {
    console.error(`billingLog ${billingLogId} tidak ditemukan`);
    process.exit(1);
  }
  if (log.status === "sukses") {
    console.log(`billingLog ${billingLogId} sudah "sukses" sebelumnya - tidak ada perubahan.`);
    process.exit(0);
  }

  await aktivasiPaketSetelahBayar(billingLogId);
  const [user] = await db.select().from(users).where(eq(users.id, log.userId));
  console.log(
    `[OK] paket diaktifkan - user=${user?.email} plan=${log.planId} ` +
    `saldoKredit=${user?.saldoKredit} periodeBerakhir=${user?.periodeBerakhir}`
  );
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
