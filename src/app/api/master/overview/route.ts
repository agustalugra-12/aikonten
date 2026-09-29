import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, plans, brands } from "@/db/schema";
import { desc, count } from "drizzle-orm";
import { getAdminOrNull } from "@/lib/admin";

// Master Dashboard - ringkasan SEMUA pelanggan (2026-09-30, permintaan Agus). Hanya admin
// (ADMIN_EMAILS) - route ini lintas-tenant, kebalikan dari isolasi biasa. Read-only.
//
// (T6, 2026-09-30) Status yang ditampilkan MENGIKUTI model status sebenarnya:
//  - status langganan (users.status, dikelola cron check-expiry): aktif / masa_tenggang /
//    terbatas. Ini BUKAN ditimpa admin.
//  - blokir manual admin (users.diblokirAdmin): terpisah, digerbangi statusGate.
// Klasifikasi tampilan menggabungkan keduanya jadi kategori yang jelas untuk owner.

export async function GET(req: NextRequest) {
  const admin = await getAdminOrNull(req);
  if (!admin) {
    return NextResponse.json({ error: "Akses khusus admin" }, { status: 403 });
  }

  const semuaPlan = await db.select().from(plans);
  const planById = new Map(semuaPlan.map((p) => [p.id, p]));
  const semuaUser = await db.select().from(users).orderBy(desc(users.createdAt));

  const brandCounts = await db
    .select({ userId: brands.userId, jumlah: count() })
    .from(brands)
    .groupBy(brands.userId);
  const brandCountByUser = new Map(brandCounts.map((b) => [b.userId, b.jumlah]));

  // Kategori tampilan:
  //  - "diblokir": disuspend admin (diblokirAdmin) - prioritas tertinggi
  //  - "tanpa_paket": belum pernah aktivasi paket (planId null)
  //  - "berlangganan": status "aktif" (langganan berlaku)
  //  - "masa_tenggang": status "masa_tenggang" (periode lewat, dlm grace, MASIH boleh generate)
  //  - "terbatas": status "terbatas" (grace lewat, TIDAK boleh generate baru)
  type Kategori = "diblokir" | "tanpa_paket" | "berlangganan" | "masa_tenggang" | "terbatas";
  function klasifikasi(u: typeof semuaUser[number]): Kategori {
    if (u.diblokirAdmin) return "diblokir";
    if (!u.planId) return "tanpa_paket";
    if (u.status === "masa_tenggang") return "masa_tenggang";
    if (u.status === "terbatas") return "terbatas";
    return "berlangganan";
  }

  const pelanggan = semuaUser.map((u) => {
    const plan = u.planId ? planById.get(u.planId) ?? null : null;
    return {
      id: u.id,
      email: u.email,
      namaBisnis: u.namaBisnis,
      status: klasifikasi(u),
      statusLangganan: u.status,
      diblokirAdmin: u.diblokirAdmin,
      saldoKredit: u.saldoKredit,
      jumlahBrand: brandCountByUser.get(u.id) ?? 0,
      plan: plan
        ? {
            id: plan.id,
            nama: plan.nama,
            kreditBulanan: plan.kreditBulanan,
            hargaBulananIdr: plan.hargaBulananIdr,
            izinAutoPosting: plan.izinAutoPosting,
            maxBrand: plan.maxBrand,
          }
        : null,
      periodeMulai: u.periodeMulai,
      periodeBerakhir: u.periodeBerakhir,
      createdAt: u.createdAt,
    };
  });

  // "Masih langganan" (untuk MRR & hitung aktif per paket) = berlangganan + masa_tenggang
  // (dua-duanya belum churn penuh; terbatas = sudah tidak bayar/berhenti generate).
  const masihLangganan = (k: Kategori) => k === "berlangganan" || k === "masa_tenggang";

  const ringkasan = {
    totalPelanggan: pelanggan.length,
    berlangganan: pelanggan.filter((p) => p.status === "berlangganan").length,
    masaTenggang: pelanggan.filter((p) => p.status === "masa_tenggang").length,
    terbatas: pelanggan.filter((p) => p.status === "terbatas").length,
    tanpaPaket: pelanggan.filter((p) => p.status === "tanpa_paket").length,
    diblokir: pelanggan.filter((p) => p.status === "diblokir").length,
    mrrIdr: pelanggan
      .filter((p) => masihLangganan(p.status) && p.plan)
      .reduce((sum, p) => sum + (p.plan?.hargaBulananIdr ?? 0), 0),
    totalSaldoKredit: pelanggan.reduce((sum, p) => sum + p.saldoKredit, 0),
  };

  const perPaket = semuaPlan.map((plan) => {
    const pelangganPaketIni = pelanggan.filter(
      (p) => p.plan?.id === plan.id && masihLangganan(p.status),
    );
    return {
      id: plan.id,
      nama: plan.nama,
      hargaBulananIdr: plan.hargaBulananIdr,
      kreditBulanan: plan.kreditBulanan,
      izinAutoPosting: plan.izinAutoPosting,
      maxBrand: plan.maxBrand,
      aktif: plan.aktif,
      jumlahPelangganAktif: pelangganPaketIni.length,
    };
  });

  return NextResponse.json({ ringkasan, perPaket, pelanggan });
}
