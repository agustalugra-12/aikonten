import OpenAI from "openai";
import { fetchPelangiKnowledge } from "./pelangiKnowledge";
import { CONTENT_PILLARS, CONTENT_ANGLES, type ContentPillar, type ContentAngle } from "./generateContent";

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

// Target komposisi Content Pillar (2026-08-05, PRD Agus, angka PERSIS dari PRD) - dipakai
// buildDistributionBlock di bawah utk bandingkan realita vs target, BUKAN cuma dijadikan
// dokumentasi mati.
const PILLAR_TARGET_PERCENT: Record<ContentPillar, number> = {
  "Pelangi Homestay": 40, "Wisata Sekitar": 25, "Tips Liburan Bedugul": 15,
  "Kuliner Sekitar": 10, "Travel Tips": 10,
};

export type RecentClassification = { pillar: string | null; angle: string | null };

// Duplicate Checker & Content Pillar NYATA (2026-08-05, PRD modul 6 & 11, permintaan
// Agus) - BEDA dari sebelumnya (instruksi teks "jangan monoton" doang, GPT nebak
// sendiri dari teks skrip mentah): sekarang dihitung dari KLASIFIKASI ASLI konten yg
// SUDAH dibuat (projects.pillar/angle, diisi generateContent.ts tiap generate), lalu
// distribusi SEBENARNYA (bukan tebakan) disuntik eksplisit ke prompt supaya AI benar2
// tahu pilar/angle mana yg SUDAH terlalu sering & mana yg kurang - bukan lagi cuma
// "usahakan beda", tapi ada angka nyata sbg pegangan.
function buildDistributionBlock(classifications: RecentClassification[]): string {
  if (classifications.length === 0) return "";

  const pillarCounts: Record<string, number> = {};
  const angleCounts: Record<string, number> = {};
  for (const c of classifications) {
    if (c.pillar) pillarCounts[c.pillar] = (pillarCounts[c.pillar] || 0) + 1;
    if (c.angle) angleCounts[c.angle] = (angleCounts[c.angle] || 0) + 1;
  }
  const total = classifications.length;

  const pillarLines = CONTENT_PILLARS.map((p) => {
    const count = pillarCounts[p] || 0;
    const actualPercent = Math.round((count / total) * 100);
    const target = PILLAR_TARGET_PERCENT[p];
    const flag = actualPercent < target - 5 ? " <- KURANG, prioritaskan" : actualPercent > target + 10 ? " <- KELEBIHAN, hindari dulu" : "";
    return `- ${p}: ${count}x (${actualPercent}%, target ${target}%)${flag}`;
  }).join("\n");

  const angleLines = CONTENT_ANGLES.map((a) => `- ${a}: ${angleCounts[a] || 0}x`)
    .sort((x, y) => {
      const cx = parseInt(x.match(/: (\d+)x/)?.[1] || "0", 10);
      const cy = parseInt(y.match(/: (\d+)x/)?.[1] || "0", 10);
      return cx - cy;
    })
    .join("\n");

  return (
    `\n\n# DISTRIBUSI PILAR & ANGLE KONTEN TERAKHIR (${total} konten, data ASLI bukan tebakan)\n` +
    `Pilar (target komposisi dari Agus):\n${pillarLines}\n\n` +
    `Angle (diurutkan dari PALING JARANG - prioritaskan yg di atas):\n${angleLines}\n\n` +
    "WAJIB pertimbangkan distribusi ini: prioritaskan pilar yg ditandai KURANG & angle yg " +
    "jarang dipakai, JANGAN tambah pilar/angle yg sudah KELEBIHAN kecuali memang tidak ada " +
    "opsi lain yg relevan dgn musim/tanggal sekarang."
  );
}

export async function suggestContentIdeas(
  brandName: string,
  brandDescription: string | null,
  recentScripts: string[],
  count: number = 4,
  recentClassifications: RecentClassification[] = []
): Promise<string[]> {
  const client = getClient();
  const today = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Makassar" });
  const knowledge = await fetchPelangiKnowledge();
  const distributionBlock = buildDistributionBlock(recentClassifications);

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
    `Skrip yg sudah pernah dipakai (JANGAN diulang, WAJIB beda angle):\n${recentScripts.length ? recentScripts.map((s) => `- ${s}`).join("\n") : "(belum ada)"}\n` +
    distributionBlock +
    `\n\nBalas HARUS JSON valid (tanpa markdown code fence): {"ideas": ["...", "...", "..."]}`;

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
