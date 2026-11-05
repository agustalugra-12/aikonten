// Seed data TIRUAN utk uji responsive (2026-11-05). TIDAK menyentuh DB produksi:
// jalankan dgn DATABASE_PATH menunjuk file sementara, mis:
//   DATABASE_PATH=/tmp/kp-rtest.db npx tsx tests/e2e/seed-rtest.ts
// Butuh tabel sudah dibuat (drizzle-kit push ke DB yg sama lebih dulu).
import { db } from "../../src/db/index.ts";
import { users, brands, projects, plans } from "../../src/db/schema.ts";

async function main() {
  const now = new Date();
  await db.insert(plans).values({
    id: "plan_pro", nama: "Pro", kreditBulanan: 100, hargaBulananIdr: 149000,
    izinAutoPosting: true, maxBrand: 5, aktif: true, createdAt: now,
  }).onConflictDoNothing();

  await db.insert(users).values({
    id: "u_rtest", email: "rtest@example.com", passwordHash: "x", nama: "Demo User",
    createdAt: now, planId: "plan_pro", saldoKredit: 50, unlimited: true, status: "aktif",
  }).onConflictDoNothing();

  await db.insert(brands).values({
    id: "b_rtest", userId: "u_rtest", name: "Pelangi Homestay",
    description: "Homestay demo untuk uji tampilan", createdAt: now,
  }).onConflictDoNothing();

  const statuses = ["published", "uploaded", "failed", "scheduled", "processing"] as const;
  const caps = [
    "Promo akhir pekan: nginap 2 malam gratis sarapan di Pelangi Homestay, Bedugul.",
    "Tips liburan hemat ke Bedugul bareng keluarga, lengkap dengan rekomendasi tempat.",
    "Behind the scenes kamar Cottage kami yang baru direnovasi.",
    "Kuliner Nasi Tempong Indra dekat homestay, wajib dicoba saat menginap.",
    "Video drone sunrise danau Beratan dari halaman homestay.",
  ];
  for (let i = 0; i < 5; i++) {
    await db.insert(projects).values({
      id: `p_rtest_${i}`, brandId: "b_rtest", type: i % 2 ? "carousel" : "video",
      status: statuses[i], generatedCaption: caps[i], script: caps[i],
      createdAt: now, updatedAt: now,
      errorMessage: statuses[i] === "failed" ? "Render gagal: contoh pesan error untuk uji tampilan" : null,
    }).onConflictDoNothing();
  }
  console.log("SEED_OK users/brands/projects");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
