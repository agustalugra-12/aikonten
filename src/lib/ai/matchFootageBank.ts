import OpenAI from "openai";
import { db } from "@/db";
import { footageBank } from "@/db/schema";
import { eq } from "drizzle-orm";

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY belum diisi di .env");
  return new OpenAI({ apiKey });
}

// Cocokkan skrip/ide baru ke footage yg SUDAH ada di bank (lihat memory proyek) - text-
// only (bukan vision) krn deskripsi+tag sudah di-generate SEKALI pas upload
// (describeFootage.ts), jadi di sini cuma perlu bandingkan teks vs teks - hemat.
export async function matchFootageForScript(brandId: string, script: string): Promise<string[]> {
  const items = await db.select().from(footageBank).where(eq(footageBank.brandId, brandId));
  if (items.length === 0) return [];

  const client = getClient();
  const catalog = items
    .map((it, i) => `${i}. [${it.mediaType}] ${it.description} (tag: ${JSON.parse(it.tags).join(", ")})`)
    .join("\n");

  const system =
    "Kamu editor konten. Diberikan skrip/ide baru & daftar footage yg TERSEDIA di bank " +
    "(bernomor), pilih 1-3 nomor footage yg PALING relevan dgn skrip ini. Kalau tidak " +
    "ada yg relevan sama sekali, balas array kosong - JANGAN paksa pilih yg tidak cocok.";
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
