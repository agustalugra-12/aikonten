import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, plans, brands } from "@/db/schema";
import { desc, count } from "drizzle-orm";
import { getAdminOrNull } from "@/lib/admin";

// Master Dashboard - ringkasan SEMUA pelanggan (2026-09-30, permintaan Agus). Hanya admin
// (ADMIN_EMAILS) yang boleh - route ini lintas-tenant, kebalikan dari isolasi biasa.
// Read-only murni. Mengembalikan: (1) statistik agregat untuk kartu ringkasan, (2) daftar
// pelanggan lengkap dengan paket, status langganan, saldo kredit, jumlah brand, dan apakah
// langganannya masih berlaku atau sudah lewat periode.

export async function GET(req: NextRequest) {
  const admin = await getAdminOrNull(req);
  if (!admin) {
    return NextResponse.json({ error: "Akses khusus admin" }, { status: 403 });
  }

  const now = Date.now();

  // Semua paket (untuk memetakan planId -> detail, dan untuk breakdown per paket).
  const semuaPlan = await db.select().from(plans);
  const planById = new Map(semuaPlan.map((p) => [p.id, p]));

  // Semua pelanggan, terbaru dulu.
  const semuaUser = await db.select().from(users).orderBy(desc(users.createdAt));

  // Jumlah brand per user (1 query agregat, bukan N query).
  const brandCounts = await db
    .select({ userId: brands.userId, jumlah: count() })
    .from(brands)
    .groupBy(brands.userId);
  const brandCountByUser = new Map(brandCounts.map((b) => [b.userId, b.jumlah]));

  // Klasifikasi status langganan tiap pelanggan:
  //  - "tanpa_paket": belum pernah pilih/aktivasi paket (planId null) -> calon pelanggan
  //  - "berlangganan": punya paket & periode masih berlaku (lanjut)
  //  - "kadaluarsa": punya paket TAPI periodeBerakhir sudah lewat (tidak lanjut/perlu renew)
  //  - "nonaktif": status akun di-set selain "aktif" (mis. disuspend admin)
  function klasifikasi(u: typeof semuaUser[number]): "tanpa_paket" | "berlangganan" | "kadaluarsa" | "nonaktif" {
    if (u.status && u.status !== "aktif") return "nonaktif";
    if (!u.planId) return "tanpa_paket";
    const berakhir = u.periodeBerakhir ? new Date(u.periodeBerakhir).getTime() : null;
    if (berakhir !== null && berakhir < now) return "kadaluarsa";
    return "berlangganan";
  }

  const pelanggan = semuaUser.map((u) => {
    const plan = u.planId ? planById.get(u.planId) ?? null : null;
    return {
      id: u.id,
      email: u.email,
      namaBisnis: u.namaBisnis,
      status: klasifikasi(u),
      statusAkun: u.status,
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

  // Agregat untuk kartu ringkasan.
  const ringkasan = {
    totalPelanggan: pelanggan.length,
    berlangganan: pelanggan.filter((p) => p.status === "berlangganan").length,
    kadaluarsa: pelanggan.filter((p) => p.status === "kadaluarsa").length,
    tanpaPaket: pelanggan.filter((p) => p.status === "tanpa_paket").length,
    nonaktif: pelanggan.filter((p) => p.status === "nonaktif").length,
    // Estimasi pendapatan bulanan berjalan (MRR) = jumlah harga paket dari pelanggan yang
    // MASIH berlangganan (bukan kadaluarsa/tanpa paket). Angka kotor dari tabel plans.
    mrrIdr: pelanggan
      .filter((p) => p.status === "berlangganan" && p.plan)
      .reduce((sum, p) => sum + (p.plan?.hargaBulananIdr ?? 0), 0),
    totalSaldoKredit: pelanggan.reduce((sum, p) => sum + p.saldoKredit, 0),
  };

  // Breakdown per paket (hanya menghitung pelanggan yang berlangganan aktif per paket,
  // plus daftar paket yang tersedia beserta harganya untuk konteks).
  const perPaket = semuaPlan.map((plan) => {
    const pelangganPaketIni = pelanggan.filter(
      (p) => p.plan?.id === plan.id && p.status === "berlangganan",
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
