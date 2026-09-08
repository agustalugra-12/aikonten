// Seed 2 paket awal Starter/Full (2026-09-08, Fase 1 Alur A/B).
//
// Angka kreditBulanan/hargaBulananIdr di bawah SEMUA PLACEHOLDER - Agus eksplisit
// "penentuan jumlah dan harga kredit bisa kita atur nanti" (belum ada keputusan final).
// Jangan anggap angka ini sudah final/siap produksi - `plans` sengaja tabel data (bukan
// konstanta kode) SUPAYA bisa diedit langsung lewat UPDATE/halaman Admin nanti tanpa
// deploy ulang. Idempotent (cek `nama` dulu) - aman dijalankan berkali-kali.
//
// Jalankan: npx tsx scripts/seed-plans.ts
import { db } from "../src/db";
import { plans } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { newId } from "../src/lib/ids";

const PAKET_AWAL = [
  {
    nama: "starter",
    kreditBulanan: 100, // PLACEHOLDER - belum ditentukan Agus
    hargaBulananIdr: 149_000, // PLACEHOLDER - belum ditentukan Agus
    izinAutoPosting: false,
    maxBrand: 1,
  },
  {
    nama: "full",
    kreditBulanan: 500, // PLACEHOLDER - belum ditentukan Agus
    hargaBulananIdr: 499_000, // PLACEHOLDER - belum ditentukan Agus
    izinAutoPosting: true,
    maxBrand: 3,
  },
];

async function main() {
  for (const p of PAKET_AWAL) {
    const [existing] = await db.select().from(plans).where(eq(plans.nama, p.nama));
    if (existing) {
      console.log(`[skip] paket "${p.nama}" sudah ada (id=${existing.id})`);
      continue;
    }
    const id = newId("plan");
    await db.insert(plans).values({ id, ...p, aktif: true, createdAt: new Date() });
    console.log(`[dibuat] paket "${p.nama}" (id=${id})`);
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
