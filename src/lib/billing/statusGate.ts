import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

// Gate status akun (2026-09-08, Fase 1 Alur C - "expiry: masa tenggang dulu baru
// downgrade ke akses terbatas, JANGAN full lock"). 3 status (lihat schema.ts users.status):
// "aktif" & "masa_tenggang" SAMA-SAMA masih boleh generate konten baru (masa tenggang =
// peringatan, bukan pembatasan fungsional - tagihan belum lunas tapi belum diblokir).
// "terbatas" (masa tenggang juga sudah lewat) = TIDAK boleh generate BARU lagi - konten
// yang SUDAH ada (download/lihat riwayat) tetap bisa diakses krn tidak ada blokir di
// route baca mana pun, cuma titik generate ini yang digerbangi.
export class AkunTerbatasError extends Error {
  constructor() {
    super("Paket sudah kadaluarsa - upgrade/perpanjang paket utk lanjut generate konten baru");
  }
}

export class AkunDiblokirError extends Error {
  constructor() {
    super("Akun diblokir oleh admin - hubungi dukungan untuk mengaktifkan kembali");
  }
}

export async function pastikanAkunBolehGenerate(userId: string): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  // Blokir admin (T6) dicek DULU - manual, terpisah dari lifecycle langganan.
  if (user?.diblokirAdmin) {
    throw new AkunDiblokirError();
  }
  if (user?.status === "terbatas") {
    throw new AkunTerbatasError();
  }
}
