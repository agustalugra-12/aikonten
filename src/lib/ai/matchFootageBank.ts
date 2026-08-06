import OpenAI from "openai";
import { db } from "@/db";
import { footageBank, footageCategories } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY belum diisi di .env");
  return new OpenAI({ apiKey });
}

// Cocokkan skrip/ide baru ke footage yg SUDAH ada di bank (lihat memory proyek) - text-
// only (bukan vision) krn deskripsi+tag sudah di-generate SEKALI pas upload
// (describeFootage.ts), jadi di sini cuma perlu bandingkan teks vs teks - hemat.
//
// Kategori manual (2026-08-06, permintaan Agus - "day use room standart maka foto yang
// di pilih memang dari vidio dan foto dsana bukan room cotage") - SEBELUM ini matching
// murni deskripsi/tag AI yg bisa terlihat MIRIP antar tipe kamar berbeda (kamar tidur,
// sprei putih, dst - ciri fisik generik yg tidak membedakan Room Standard vs Cottage).
// Kategori (lihat schema.ts footageCategories) dilampirkan ke tiap baris katalog SEBAGAI
// LABEL EKSPLISIT & instruksi eksplisit melarang campur kategori kamar - AI tetap yg
// putuskan relevansi (bukan filter keyword hardcode di kode, krn nama kategori/tipe
// kamar beda2 per brand), tapi sekarang py sinyal struktural yg tidak ambigu.
export async function matchFootageForScript(brandId: string, script: string): Promise<string[]> {
  const items = await db.select().from(footageBank).where(eq(footageBank.brandId, brandId));
  if (items.length === 0) return [];

  const categories = await db.select().from(footageCategories).where(eq(footageCategories.brandId, brandId));
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  const client = getClient();
  const catalog = items
    .map((it, i) => {
      const categoryLabel = it.categoryId ? categoryNameById.get(it.categoryId) || null : null;
      const categoryTag = categoryLabel ? `[kategori: ${categoryLabel}] ` : "";
      return `${i}. [${it.mediaType}] ${categoryTag}${it.description} (tag: ${JSON.parse(it.tags).join(", ")})`;
    })
    .join("\n");

  const system =
    "Kamu editor konten. Diberikan skrip/ide baru & daftar footage yg TERSEDIA di bank " +
    "(bernomor), pilih SEMUA nomor footage yg RELEVAN dgn skrip ini (boleh 1 sampai " +
    "15 - lebih banyak footage video asli yg relevan LEBIH BAIK drpd dikit, video final " +
    "akan digabung dari beberapa klip sekaligus). Kalau tidak ada yg relevan sama " +
    "sekali, balas array kosong - JANGAN paksa pilih yg tidak cocok. " +
    "PENTING soal [kategori: ...]: kalau skrip menyebut tipe kamar/area SPESIFIK (mis. " +
    "\"Room Standard\", \"Cottage\", \"Day Use Room Standard\", \"dapur\", \"taman\"), " +
    "WAJIB pilih HANYA footage yg kategorinya cocok dgn tipe/area itu (atau tidak " +
    "berkategori TAPI deskripsinya benar2 cocok) - JANGAN PERNAH campur footage dari " +
    "kategori kamar/area LAIN yg berbeda, walau deskripsi teksnya terlihat mirip (mis. " +
    "skrip ttg \"Room Standard\" TIDAK BOLEH pakai footage berkategori \"Cottage\"). " +
    "Kalau skrip TIDAK menyebut tipe/area spesifik, kategori boleh diabaikan.";
  const user =
    `Skrip/ide:\n${script}\n\nFootage tersedia:\n${catalog}\n\n` +
    `Balas HARUS JSON valid (tanpa markdown code fence): {"indices": [0, 2]}`;

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.3,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "{}";
  const cleaned = raw.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
  const parsed = JSON.parse(cleaned);
  const indices: number[] = Array.isArray(parsed.indices) ? parsed.indices : [];

  return indices
    .filter((i) => Number.isInteger(i) && i >= 0 && i < items.length)
    .map((i) => items[i].fileUrl);
}

// Fallback foto LONGGAR (2026-08-04, permintaan Agus) - kalau matchFootageForScript tidak
// ketemu foto yg cocok TEMA persis, tapi bank sebenarnya PUNYA foto asli properti (apa
// saja), tetap pakai itu drpd gagal total - keputusan eksplisit Agus: foto WAJIB selalu
// asli Pelangi/Harmoni (TIDAK BOLEH Pexels sama sekali, beda dari video yg boleh fallback
// Pexels utk ide umum), tapi foto tidak perlu cocok tema persis krn overlay teks promo
// (lihat promoOverlay.ts) yg menyampaikan pesan spesifiknya, bukan foto itu sendiri.
// Ambil foto TERBARU (bukan acak) - lebih mungkin representatif/kualitas konsisten drpd
// upload lama yg mungkin sudah basi (kamar direnovasi, dst).
export async function pickAnyRealPhoto(brandId: string): Promise<string | null> {
  const items = await db
    .select()
    .from(footageBank)
    .where(and(eq(footageBank.brandId, brandId), eq(footageBank.mediaType, "image")))
    .orderBy(desc(footageBank.createdAt))
    .limit(1);
  return items[0]?.fileUrl || null;
}
