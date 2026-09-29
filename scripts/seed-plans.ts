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
    kreditBulanan: 50,
    hargaBulananIdr: 149_000,
    izinAutoPosting: false, // Starter = download only (tanpa auto-post ke Buffer)
    maxBrand: 1,
  },
  {
    nama: "pro",
    kreditBulanan: 100,
    hargaBulananIdr: 299_000,
    izinAutoPosting: true, // Pro & Agency = boleh auto-post
    maxBrand: 1,
  },
  {
    nama: "agency",
    kreditBulanan: 150,
    hargaBulananIdr: 550_000,
    izinAutoPosting: true,
    maxBrand: 1, // Agus: "semua 1 brand saja agar tidak ribet"
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
