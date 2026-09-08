import { db } from "@/db";
import { users, plans, billingLog } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isiUlangKredit } from "./credits";

const MASA_AKTIF_HARI = 30;

// Aktivasi paket setelah pembayaran DIKONFIRMASI sukses (2026-09-08, Fase 1 Alur A).
// Ini fungsi yang akan dipanggil webhook payment gateway ASLI nanti (Tripay dkk, belum
// disambungkan - "kredensial disambungkan di akhir") - dibangun sekarang supaya begitu
// webhook itu ada, isinya cuma: verifikasi signature -> cari billingLog via gatewayRef ->
// panggil fungsi ini. Untuk sekarang (belum ada gateway), dipicu manual lewat
// scripts/confirm-payment.ts - TIDAK ada endpoint publik yang memanggil ini tanpa
// verifikasi pembayaran asli, sengaja, supaya tidak ada jalan pintas kredit gratis.
export async function aktivasiPaketSetelahBayar(billingLogId: string): Promise<void> {
  const [log] = await db.select().from(billingLog).where(eq(billingLog.id, billingLogId));
  if (!log) throw new Error(`billingLog ${billingLogId} tidak ditemukan`);
  if (log.status === "sukses") return; // idempotent - webhook bisa terkirim dobel

  const [plan] = await db.select().from(plans).where(eq(plans.id, log.planId));
  if (!plan) throw new Error(`plan ${log.planId} tidak ditemukan`);

  const now = new Date();
  const periodeBerakhir = new Date(now.getTime() + MASA_AKTIF_HARI * 24 * 60 * 60 * 1000);

  await db.update(billingLog).set({ status: "sukses" }).where(eq(billingLog.id, billingLogId));
  await db.update(users).set({
    planId: plan.id,
    status: "aktif",
    periodeMulai: now,
    periodeBerakhir,
  }).where(eq(users.id, log.userId));
  await isiUlangKredit(log.userId, plan.kreditBulanan, "isi_ulang_bulanan");
}
