import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron/verify";
import { db } from "@/db";
import { billingLog } from "@/db/schema";
import { and, eq, gt } from "drizzle-orm";
import { getTransactionDetail, tripayCreateReady } from "@/lib/billing/tripay";
import { deskripsiTagihan, prosesPembayaranGagal } from "@/lib/billing/activation";
import { notifRekonsiliasi } from "@/lib/billing/notify";
import { AMBANG_MENGGANTUNG_MS, menggantung, petakanStatusTripay } from "@/lib/billing/statusPembayaran";

// Cron rekonsiliasi pembayaran (2026-11-07). Masalah yang dijawab: aktivasi HANYA bergantung
// webhook Tripay. Kalau webhook tak sampai (salah URL callback, app mati, 5xx sesaat), uang
// pelanggan sudah masuk tapi tagihan kita diam di `pending` selamanya DAN tak ada satu pun
// yang tahu. Cron ini mengejar tiap billingLog `pending` ke API Tripay lalu MELAPOR.
//
// KEPUTUSAN SENGAJA - TIDAK memberi kredit otomatis dari hasil polling:
//   prosesPembayaranSukses memang sudah exactly-once (kunci credit_transactions.ref_billing_id),
//   jadi dobel kredit bukan risikonya. Yang jadi alasan: invariant "aktivasi hanya lewat webhook
//   TERVERIFIKASI (HMAC)" adalah satu-satunya pengaman anti-aktivasi-palsu di sistem ini, dan
//   menambah jalur uang kedua yang dipicu cron = jalur baru yang harus diaudit sendiri (salah
//   mapping status Tripay = kredit gratis, dan tak ada yg menonton). Jadi: LAPOR ke Telegram,
//   owner konfirmasi di /master (jalur manual yg sudah ada & sudah dipakai).
//   ponytail: lapor-saja; kalau antrean "PAID tapi pending" jadi rutin, promosikan ke
//   auto-aktivasi dgn mencocokkan amount + reference sebelum memanggil prosesPembayaranSukses.
//
// Yang DIUBAH otomatis hanya status GAGAL (EXPIRED/FAILED/REFUND) - tak ada uang/kredit
// bergerak, cuma merapikan tagihan mati supaya tak dihitung "menggantung" tiap 15 menit.
//
// Dipanggil systemd timer lokal: scripts/cron/aikonten-saas-reconcile-billing.timer
// (otentikasi X-Cron-Key, bukan sesi - lihat lib/cron/verify.ts).

// Jangan kejar tagihan purba: transaksi Tripay kedaluwarsa dalam jam-an, dan detail transaksi
// lama tak berguna lagi (sudah diputuskan manual atau memang ditinggalkan pelanggan).
const BATAS_UMUR_HARI = 7;

export async function POST(req: NextRequest) {
  const unauthorized = verifyCronSecret(req);
  if (unauthorized) return unauthorized;

  const now = Date.now();
  const sejak = new Date(now - BATAS_UMUR_HARI * 24 * 60 * 60 * 1000);
  const pending = await db.select().from(billingLog)
    .where(and(eq(billingLog.status, "pending"), gt(billingLog.createdAt, sejak)));

  const lunasTakBerkredit: string[] = [];
  const tergantung: string[] = [];
  let ditandaiGagal = 0;
  let gagalCek = 0;

  for (const log of pending) {
    const umurMenit = Math.round((now - log.createdAt.getTime()) / 60000);
    const label = `${await deskripsiTagihan(log)} — Rp${log.jumlahBayarIdr.toLocaleString("id-ID")} · <code>${log.id}</code> · ${umurMenit} menit`;

    // Tanpa gatewayRef kita tak punya apa pun untuk ditanyakan ke Tripay (create gagal di
    // tengah jalan, atau jalur manual BCA). Cukup laporkan kalau sudah menggantung.
    if (!log.gatewayRef || !tripayCreateReady()) {
      if (menggantung(log.createdAt.getTime(), now)) tergantung.push(`${label} (tanpa ref gateway)`);
      continue;
    }

    let statusTripay: string;
    try {
      statusTripay = (await getTransactionDetail(log.gatewayRef)).status;
    } catch (e) {
      gagalCek++;
      console.error(`[reconcile-billing] gagal cek ${log.id} (${log.gatewayRef}):`, e);
      if (menggantung(log.createdAt.getTime(), now)) tergantung.push(`${label} (cek Tripay gagal)`);
      continue;
    }

    const hasil = petakanStatusTripay(statusTripay);
    if (hasil === "sukses") {
      lunasTakBerkredit.push(`${label} · Tripay: PAID`);
    } else if (hasil === "gagal") {
      await prosesPembayaranGagal(log.id, `rekonsiliasi — Tripay: ${statusTripay}`);
      ditandaiGagal++;
    } else if (menggantung(log.createdAt.getTime(), now)) {
      tergantung.push(`${label} · Tripay: ${statusTripay}`);
    }
  }

  await notifRekonsiliasi(lunasTakBerkredit, tergantung);

  return NextResponse.json({
    ok: true,
    diperiksa: pending.length,
    lunas_tapi_pending: lunasTakBerkredit.length,
    menggantung: tergantung.length,
    ditandai_gagal: ditandaiGagal,
    gagal_cek: gagalCek,
    ambang_menggantung_menit: AMBANG_MENGGANTUNG_MS / 60000,
  });
}
