import { getOpenAIClient } from "./openaiClient";
import { db } from "@/db";
import { brands } from "@/db/schema";
import { eq } from "drizzle-orm";
import { GENERIC_PILLARS, PELANGI_PILLARS } from "./generateContent";

// Planner Fase 2 (2026-10-05) - isi rencana otomatis. Batch generator: minta OpenAI bikin
// N ide konten (pillar/hook/topik/caption/hashtag) utk mengisi baris content_plan yang
// masih kosong. Di-chunk (15/call) supaya respons tak kepanjangan & tiap chunk diberi
// rentang biar TIDAK mengulang tema. Teks saja - TIDAK pakai Gemini/biaya gambar.

export type PlanEntry = { pillar: string; hook: string; topic: string; script: string; caption: string; hashtags: string[] };

const CHUNK = 15;

export async function generatePlanEntries(brandId: string, count: number): Promise<PlanEntry[]> {
  if (count <= 0) return [];
  const [brand] = await db.select().from(brands).where(eq(brands.id, brandId));
  if (!brand) return [];
  const pillarList = brand.knowledgeSite === "pelangi" ? PELANGI_PILLARS : GENERIC_PILLARS;
  const client = getOpenAIClient();
  const out: PlanEntry[] = [];

  for (let start = 0; start < count; start += CHUNK) {
    const n = Math.min(CHUNK, count - start);
    try {
      const completion = await client.chat.completions.create({
        model: "gpt-4.1-mini",
        temperature: 0.8,
        messages: [
          {
            role: "system",
            content:
              `Kamu perencana konten sosial media untuk brand "${brand.name}". Buat ide konten BARU yang ` +
              `beragam dan TIDAK berulang temanya. Pilar HARUS salah satu dari: ${pillarList.join(", ")}.` +
              (brand.manualKnowledge ? ` Info brand (pakai utk relevansi, jangan mengarang di luar ini): ${brand.manualKnowledge.slice(0, 1500)}` : ""),
          },
          {
            role: "user",
            content:
              `Buat ${n} ide konten (ide ke-${start + 1} sampai ke-${start + n} dari total ${count} - JANGAN ulang tema ide sebelumnya). ` +
              `Tiap ide berisi: pillar (salah satu dari daftar), hook (kalimat pembuka menarik, maks 12 kata), ` +
              `topic (topik spesifik 1 kalimat), script (NASKAH/BRIEF konten 2-4 kalimat: alur dari hook, isi/poin utama, sampai CTA - jadi dasar pembuatan konten, Bahasa Indonesia), caption (draft caption sosmed 2-4 kalimat, Bahasa Indonesia, ramah & natural), ` +
              `hashtags (array 4-6 hashtag relevan, tiap item diawali # tanpa spasi). ` +
              `Balas HARUS JSON valid tanpa markdown code fence: ` +
              `{"ideas":[{"pillar":"...","hook":"...","topic":"...","script":"...","caption":"...","hashtags":["#..."]}]}`,
          },
        ],
      });
      const raw = (completion.choices[0]?.message?.content || "{}").replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
      const parsed = JSON.parse(raw);
      const ideas = Array.isArray(parsed?.ideas) ? parsed.ideas : [];
      for (const it of ideas) {
        out.push({
          pillar: typeof it?.pillar === "string" ? it.pillar : String(pillarList[0]),
          hook: typeof it?.hook === "string" ? it.hook : "",
          topic: typeof it?.topic === "string" ? it.topic : "",
          script: typeof it?.script === "string" ? it.script : "",
          caption: typeof it?.caption === "string" ? it.caption : "",
          hashtags: Array.isArray(it?.hashtags) ? it.hashtags.filter((h: unknown): h is string => typeof h === "string") : [],
        });
      }
    } catch {
      // chunk gagal (parse/API) - lewati, chunk lain tetap jalan (fail-soft).
    }
  }
  return out.slice(0, count);
}

// Isi SKRIP saja utk baris yg sudah punya hook/topik tapi scriptBrief kosong (2026-10-05,
// temuan Agus). Skrip dibuat DARI hook/topik yg ada (tak menimpa hook/caption owner).
export async function generateScriptsFromHooks(
  brandId: string,
  items: { hook: string; topic: string; contentType: string }[]
): Promise<string[]> {
  if (items.length === 0) return [];
  const [brand] = await db.select().from(brands).where(eq(brands.id, brandId));
  const client = getOpenAIClient();
  const out: string[] = [];
  for (let start = 0; start < items.length; start += CHUNK) {
    const slice = items.slice(start, start + CHUNK);
    const lines = slice.map((it, i) => `${i + 1}. [${it.contentType}] Hook: ${it.hook}${it.topic ? " | Topik: " + it.topic : ""}`).join("\n");
    try {
      const completion = await client.chat.completions.create({
        model: "gpt-4.1-mini",
        temperature: 0.7,
        messages: [
          {
            role: "system",
            content:
              "Kamu penulis naskah konten sosial media untuk brand \"" + (brand?.name || "Brand") + "\". Untuk TIAP item (hook + topik), tulis NASKAH/BRIEF konten: 2-4 kalimat, alur dari hook -> poin utama -> CTA, Bahasa Indonesia natural, PERTAHANKAN maksud & topik hook-nya (jangan ganti topik).",
          },
          {
            role: "user",
            content:
              "Item:\n" + lines + "\n\nBalas HARUS JSON valid tanpa markdown code fence, array \"scripts\" URUT SAMA dgn nomor item: {\"scripts\":[\"naskah item 1\", \"naskah item 2\"]}",
          },
        ],
      });
      const raw = (completion.choices[0]?.message?.content || "{}").replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
      const parsed = JSON.parse(raw);
      const scripts = Array.isArray(parsed?.scripts) ? parsed.scripts : [];
      for (let i = 0; i < slice.length; i++) out.push(typeof scripts[i] === "string" ? scripts[i] : "");
    } catch {
      for (let i = 0; i < slice.length; i++) out.push("");
    }
  }
  return out;
}
