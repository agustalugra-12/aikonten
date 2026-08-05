import OpenAI from "openai";
import { fetchPelangiKnowledge } from "./pelangiKnowledge";

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY belum diisi di .env");
  return new OpenAI({ apiKey });
}

// "Research Engine" versi ringan (keputusan Agus: pakai pengetahuan GPT saja, BUKAN
// integrasi API tren berbayar - lihat memory proyek) - AI usul ide konten berdasarkan
// niche brand + tanggal skrg (relevansi musiman) + histori skrip brand ini sendiri
// (biar tidak ngulang ide yg sama). BUKAN data tren real-time asli, cuma usulan
// masuk akal dari pengetahuan umum model.
//
// Knowledge Base grounding (2026-08-05, permintaan Agus - dikutip persis: "aku mau
// pengetahuan untuk ide konten bisa kamu ambil dari website pelangi... agar konteks
// konten tidak keluar jalur" - "ini adalah titik yang akan membedakan AI Content
// milikmu dengan AI video generator lain") - REUSE fakta yg SUDAH ada & battle-tested
// di web-pelangi (kamar/harga/fasilitas ASLI, larangan eksplisit klaim fasilitas yg
// TIDAK dimiliki, fakta radius/landmark wisata sekitar Bedugul) via
// pelangiKnowledge.ts, BUKAN bikin knowledge base baru dari nol.
// Tanggal WITA (Bedugul/Bali, UTC+8) - dipakai jg oleh dailyContentPlanner.ts (batas
// "hari ini" utk batch ide harian) supaya konsisten dgn zona bisnis Agus, bukan UTC
// (sama alasannya dgn BALI_TZ di web-pelangi/backend/server.py).
export function todayDateKeyWita(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Makassar" }); // "YYYY-MM-DD"
}

export async function suggestContentIdeas(
  brandName: string,
  brandDescription: string | null,
  recentScripts: string[],
  count: number = 4
): Promise<string[]> {
  const client = getClient();
  const today = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Makassar" });
  const knowledge = await fetchPelangiKnowledge();

  const system =
    `Kamu content strategist media sosial utk bisnis lokal Indonesia. Usulkan ${count} ide ` +
    "brief konten singkat (1-2 kalimat tiap ide, Bahasa Indonesia) yang RELEVAN dgn " +
    "niche brand & musim/tanggal sekarang. Ide harus konkret & bisa langsung difilmkan " +
    "dgn footage asli (bukan konsep abstrak) - fokus ke hal yg BENAR-BENAR ada di " +
    "tempat/bisnis semacam ini, JANGAN mengarang fasilitas/promo yg belum tentu ada. " +
    "JANGAN ulangi ide yg mirip dgn skrip yg sudah pernah dipakai brand ini - kalau " +
    "topik besarnya sama (mis. sama-sama soal harga), WAJIB angle/sudut pandang yg " +
    "BEDA drpd yg sudah pernah dipakai (mis. harga vs lokasi vs sarapan vs suasana vs " +
    "target tamu tertentu), bukan variasi kalimat dari ide yg sama. " +
    (count > 5
      ? `SEMUA ${count} ide dalam batch ini JUGA WAJIB angle BEDA satu sama lain (bukan cuma ` +
        "beda drpd histori) - variasikan: harga/value, lokasi/jarak ke wisata sekitar, " +
        "fasilitas spesifik, suasana/pengalaman, target tamu (keluarga/pasangan/rombongan/" +
        "solo), momen/waktu (pagi/sore/weekend), FAQ/edukasi produk (mis. \"day use itu " +
        "apa?\"), perbandingan (mis. day use vs menginap). "
      : "") +
    (knowledge
      ? "\n\nKAMU PUNYA KNOWLEDGE BASE ASLI PROPERTI DI BAWAH (KAMAR/FASILITAS/RADIUS " +
        "WISATA) - WAJIB PATUHI INI KETAT: (1) SEMUA klaim fasilitas/harga/kamar HARUS " +
        "berasal dari Knowledge Base ini, JANGAN mengarang di luar itu. (2) Kalau " +
        "Knowledge Base eksplisit bilang properti TIDAK punya sesuatu (mis. kolam " +
        "renang/rental motor/jemput bandara), JANGAN PERNAH usulkan ide yg mengasumsikan " +
        "itu ada - boleh usulkan ide yg JUJUR menjawab pertanyaan itu (mis. \"opsi " +
        "transport ke Pelangi tanpa harus sewa mobil sendiri\") TAPI tidak boleh " +
        "mengklaim py layanan itu. (3) Ide soal destinasi/wisata HARUS landmark yg " +
        "DISEBUT di Knowledge Base (radius dekat properti) - JANGAN usulkan destinasi " +
        "di luar radius itu (mis. Kuta/Seminyak/Nusa Penida), itu tidak relevan & " +
        "menyesatkan calon tamu yg cari penginapan DEKAT lokasi spesifik ini."
      : "");
  const user =
    `Brand: ${brandName}\nDeskripsi/niche: ${brandDescription || "(tidak ada deskripsi)"}\n` +
    `Tanggal hari ini: ${today}\n\n` +
    (knowledge ? `# KNOWLEDGE BASE ASLI PROPERTI\n${knowledge}\n\n` : "") +
    `Skrip yg sudah pernah dipakai (JANGAN diulang, WAJIB beda angle):\n${recentScripts.length ? recentScripts.map((s) => `- ${s}`).join("\n") : "(belum ada)"}\n\n` +
    `Balas HARUS JSON valid (tanpa markdown code fence): {"ideas": ["...", "...", "..."]}`;

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.8,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "{}";
  const cleaned = raw.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
  const parsed = JSON.parse(cleaned);
  return Array.isArray(parsed.ideas) ? parsed.ideas : [];
}
