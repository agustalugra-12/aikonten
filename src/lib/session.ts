import { NextRequest } from "next/server";
import { db } from "@/db";
import { brands, plans, users } from "@/db/schema";
import { and, count, eq } from "drizzle-orm";

// Helper isolasi antar-pelanggan (2026-09-07, PRD "AI Konten by Agustap Studio" Fase 1,
// Alur D). middleware.ts SUDAH memverifikasi sesi & menaruh userId di header `x-user-id`
// sebelum request sampai ke route handler - fungsi di sini TINGGAL baca header itu
// (bukan verifikasi JWT ulang, itu tugas middleware) & terapkan ke query data.
export function getUserId(req: NextRequest): string {
  const userId = req.headers.get("x-user-id");
  if (!userId) {
    // Seharusnya TIDAK PERNAH terjadi (middleware sudah menjamin) - kalau sampai
    // terjadi, itu bug di middleware/konfigurasi matcher, bukan kondisi normal yang
    // boleh didiamkan sbg "user anonim".
    throw new Error("x-user-id hilang - middleware auth tidak jalan utk route ini");
  }
  return userId;
}

// Kunci isolasi utama - pastikan brandId yang diminta BENAR milik userId yang login.
// Balikin null (BUKAN throw) kalau tidak ditemukan/bukan milik user ini - pemanggil
// WAJIB balas 404 (bukan 403) supaya tidak bocorkan "brand ini ada tapi bukan
// punyamu" ke pelanggan lain yang iseng coba-coba ID orang lain.
export async function getOwnedBrand(userId: string, brandId: string) {
  const [brand] = await db
    .select()
    .from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.userId, userId)));
  return brand ?? null;
}

// Cek kuota maxBrand plan SEBELUM izinkan bikin brand baru (2026-09-07) - dibaca dari
// tabel `plans` (data, bisa diubah Admin), BUKAN angka hardcode. User tanpa plan (belum
// pernah bayar/masih onboarding) dianggap 0 kuota - registrasi brand pertama HARUS
// lewat alur setelah pembayaran (Alur A), bukan sebelum ada plan sama sekali.
export async function canCreateAnotherBrand(userId: string): Promise<{ ok: boolean; reason?: string }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.planId) return { ok: false, reason: "Akun belum punya paket aktif" };

  const [plan] = await db.select().from(plans).where(eq(plans.id, user.planId));
  if (!plan) return { ok: false, reason: "Paket tidak ditemukan" };

  const [{ jumlah }] = await db
    .select({ jumlah: count() })
    .from(brands)
    .where(eq(brands.userId, userId));

  if (jumlah >= plan.maxBrand) {
    return { ok: false, reason: `Paket "${plan.nama}" maksimal ${plan.maxBrand} brand - upgrade untuk tambah lagi` };
  }
  return { ok: true };
}
