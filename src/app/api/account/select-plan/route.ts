import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { plans, billingLog } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getUserId } from "@/lib/session";
import { newId } from "@/lib/ids";

// Pilih paket (2026-09-08, Fase 1 Alur A) - HANYA membuat tagihan berstatus "pending",
// TIDAK mengaktifkan paket/mengisi kredit sama sekali (itu tugas
// aktivasiPaketSetelahBayar, dipanggil dari webhook payment gateway ASLI - belum
// disambungkan, "kredensial disambungkan di akhir"). Route ini aman dipanggil berkali-
// kali (mis. user berubah pikiran pilih paket lain sebelum benar2 bayar) - tiap panggilan
// bikin baris billingLog baru, TIDAK menghapus yang lama (riwayat penuh, sama pola dgn
// payment_log Tripay di PMS Pelangi).
export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  const { planId } = await req.json();
  if (typeof planId !== "string" || !planId) {
    return NextResponse.json({ error: "planId wajib diisi" }, { status: 400 });
  }

  const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
  if (!plan || !plan.aktif) {
    return NextResponse.json({ error: "Paket tidak ditemukan" }, { status: 404 });
  }

  const id = newId("bill");
  await db.insert(billingLog).values({
    id,
    userId,
    planId: plan.id,
    jumlahBayarIdr: plan.hargaBulananIdr,
    status: "pending",
    gatewayRef: null,
    createdAt: new Date(),
  });

  return NextResponse.json({
    ok: true,
    billingLogId: id,
    // Belum ada payment gateway tersambung - tidak ada checkoutUrl/QR sungguhan utk
    // dikembalikan. Frontend sementara tampilkan "menunggu konfirmasi pembayaran"
    // (status pending), bukan halaman bayar asli.
    status: "pending",
    jumlahBayarIdr: plan.hargaBulananIdr,
  }, { status: 201 });
}
