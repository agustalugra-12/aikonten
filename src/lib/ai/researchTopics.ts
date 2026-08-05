import OpenAI from "openai";
import { fetchPelangiKnowledge, mergeManualKnowledge } from "./pelangiKnowledge";
import { CONTENT_PILLARS, CONTENT_ANGLES, type ContentPillar, type ContentAngle } from "./generateContent";
import { buildSeasonalContext } from "./seasonalContext";
import { buildKeywordPriorityBlock, type KeywordClassification } from "./keywordPriority";
import { buildPerformanceInsightBlock, type PerformanceClassification } from "./performanceLearning";

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

export type RecentClassification = KeywordClassification & { pillar: string | null; angle: string | null };

// Content Restriction (2026-08-05, PRD modul 8, permintaan Agus - "AI DILARANG membuat
// konten politik/agama/gosip/artis/crypto/trading/sepak bola/drama/semua yg tidak
// berhubungan dgn Pelangi/Bedugul/Travel"). Risiko rendah krn ide SUDAH di-scope ketat
// ke brand+niche+Knowledge Base (lihat prompt di bawah), TAPI tetap dipasang jaring
// pengaman KODE (bukan cuma instruksi prompt yg bisa saja diabaikan model) - sama
// disiplin dgn guard "LARANGAN KERAS" di ai-chat-bot (deteksi + koreksi kode, bukan
// cuma percaya instruksi teks). Kata kunci Bahasa Indonesia & Inggris umum, longgar
// tapi cukup utk nangkep topik yg JELAS di luar jalur.
const RESTRICTED_TOPIC_KEYWORDS = [
  "politik", "pemilu", "capres", "partai politik", "agama", "gereja", "masjid", "pura",
  "vihara", "gosip", "artis", "selebriti", "crypto", "cryptocurrency", "bitcoin", "trading",
  "saham", "forex", "sepak bola", "sepakbola", "liga champions", "piala dunia", "drama korea",
  "sinetron", "gibah",
];

function isRestrictedIdea(idea: string): boolean {
  const lower = idea.toLowerCase();
  return RESTRICTED_TOPIC_KEYWORDS.some((kw) => lower.includes(kw));
}

const RESTRICTION_PROMPT_FRAGMENT =
  " LARANGAN KERAS: JANGAN PERNAH usulkan ide bertema politik, agama, gosip/artis/" +
  "selebriti, crypto/trading/saham, olahraga (sepak bola dst), atau drama/hiburan yg " +
  "TIDAK ADA hubungannya dgn Pelangi Homestay/Bedugul/travel - SEMUA ide WAJIB " +
  "berhubungan langsung dgn properti, wisata sekitar, atau travel tips yg relevan.";

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

// Diekstrak (2026-08-05) supaya dipakai BARENG oleh suggestContentIdeas (on-demand,
// balikin string[] polos) & suggestScoredContentIdeas (Opportunity Finder - PRD modul
// "senjata", balikin skor per-ide) - konteks (grounding/kalender/distribusi/keyword)
// SAMA PERSIS, cuma instruksi format balasan JSON di ujung yg beda.
async function buildIdeaPromptBase(
  brandName: string,
  brandDescription: string | null,
  recentScripts: string[],
  count: number,
  recentClassifications: RecentClassification[],
  knowledgeSite?: string | null,
  manualKnowledge?: string | null
): Promise<{ system: string; user: string }> {
  const today = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Makassar" });
  const knowledge = mergeManualKnowledge(await fetchPelangiKnowledge(knowledgeSite || "pelangi"), manualKnowledge);
  const distributionBlock = buildDistributionBlock(recentClassifications);
  const seasonalBlock = buildSeasonalContext();
  const keywordBlock = buildKeywordPriorityBlock(recentClassifications);

  const system =
    `Kamu content strategist media sosial utk bisnis lokal Indonesia. Usulkan ${count} ide ` +
    "brief konten singkat (1-2 kalimat tiap ide, Bahasa Indonesia) yang RELEVAN dgn " +
    "niche brand & musim/tanggal sekarang - manfaatkan # KONTEKS KALENDER di bawah kalau " +
    "relevan (mis. weekend/libur nasional - ide \"persiapan liburan\"/promo), TAPI JANGAN " +
    "PAKSA semua ide berbau kalender kalau tidak natural. Ide harus konkret & bisa langsung difilmkan " +
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
      : "") +
    RESTRICTION_PROMPT_FRAGMENT;
  const user =
    `Brand: ${brandName}\nDeskripsi/niche: ${brandDescription || "(tidak ada deskripsi)"}\n` +
    `Tanggal hari ini: ${today}\n` +
    seasonalBlock +
    (knowledge ? `\n\n# KNOWLEDGE BASE ASLI PROPERTI\n${knowledge}\n\n` : "\n\n") +
    `Skrip yg sudah pernah dipakai (JANGAN diulang, WAJIB beda angle):\n${recentScripts.length ? recentScripts.map((s) => `- ${s}`).join("\n") : "(belum ada)"}\n` +
    distributionBlock +
    keywordBlock;

  return { system, user };
}

function filterRestricted(ideas: string[]): string[] {
  const filtered = ideas.filter((idea) => !isRestrictedIdea(idea));
  if (filtered.length < ideas.length) {
    console.warn(`[researchTopics] ${ideas.length - filtered.length} ide di-filter (topik di luar jalur - politik/gosip/dst)`);
  }
  return filtered;
}

export async function suggestContentIdeas(
  brandName: string,
  brandDescription: string | null,
  recentScripts: string[],
  count: number = 4,
  recentClassifications: RecentClassification[] = [],
  knowledgeSite?: string | null,
  manualKnowledge?: string | null
): Promise<string[]> {
  const client = getClient();
  const { system, user } = await buildIdeaPromptBase(brandName, brandDescription, recentScripts, count, recentClassifications, knowledgeSite, manualKnowledge);

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: `${user}\n\nBalas HARUS JSON valid (tanpa markdown code fence): {"ideas": ["...", "...", "..."]}` },
    ],
    temperature: 0.8,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "{}";
  const cleaned = raw.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
  const parsed = JSON.parse(cleaned);
  const ideas: string[] = Array.isArray(parsed.ideas) ? parsed.ideas : [];
  // Jaring pengaman KODE (2026-08-05) - filter lagi di sini, JANGAN cuma percaya
  // instruksi prompt di atas (sama disiplin dgn guard ai-chat-bot: instruksi teks bisa
  // saja diabaikan model, filter kode tidak).
  return filterRestricted(ideas);
}

export type ScoredIdea = {
  idea: string;
  score: number; // 0-100
  reasoning: string;
  contentType: "video" | "foto" | "carousel";
};

// Opportunity Finder (2026-08-05, PRD "AI Content Brain" - fitur yg Agus sendiri sebut
// "senjata": "membaca keyword target utama, melihat knowledge base, menghasilkan ide
// BARU, memberi skor tiap ide berdasarkan relevansi/potensi menarik/variasi/dukungan
// keyword utama"). Reuse PERSIS konteks yg sama dgn suggestContentIdeas (grounding/
// kalender/distribusi/keyword priority sudah dibangun modul2 sebelumnya - fondasinya
// SUDAH ADA, ini cuma nambah lapisan SKOR eksplisit di atasnya) - dipakai
// dailyContentPlanner.ts (batch 10 ide/hari), BUKAN on-demand "Ide Konten" cepat (biar
// tetap ringan/cepat spt sebelumnya, tidak semua jalur butuh skor).
//
// videoCount/carouselCount (2026-08-05, permintaan Agus - "dari 10 konten ini 3 dibuat
// foto 7 dibuat video") - GPT diminta assign contentType per ide TAPI jumlah PERSIS
// dipaksa di kode (enforceContentTypeSplit di bawah), bukan cuma percaya model
// menghitung benar - sama disiplin dgn guard lain sesi ini (instruksi teks + jaring
// pengaman kode).
export async function suggestScoredContentIdeas(
  brandName: string,
  brandDescription: string | null,
  recentScripts: string[],
  videoCount: number,
  fotoCount: number,
  carouselCount: number,
  recentClassifications: RecentClassification[] = [],
  performanceClassifications: PerformanceClassification[] = [],
  knowledgeSite?: string | null,
  manualKnowledge?: string | null
): Promise<ScoredIdea[]> {
  const client = getClient();
  const count = videoCount + fotoCount + carouselCount;
  const { system, user } = await buildIdeaPromptBase(brandName, brandDescription, recentScripts, count, recentClassifications, knowledgeSite, manualKnowledge);
  const performanceBlock = buildPerformanceInsightBlock(performanceClassifications);

  const scoredSystem =
    system +
    " SETIAP ide WAJIB diberi score 0-100 (integer) berdasarkan 4 kriteria PERSIS ini " +
    "(pertimbangkan SEMUA, bukan cuma 1): (1) RELEVANSI dgn Pelangi Homestay/Bedugul - " +
    "seberapa langsung ide ini berhubungan dgn properti/lokasinya. (2) POTENSI MENARIK " +
    "calon tamu - seberapa besar kemungkinan ide ini bikin orang berhenti scroll & " +
    "tertarik (kalau ada # PERFORMA KONTEN NYATA di bawah, PAKAI itu sbg sinyal nyata, " +
    "bukan cuma tebakan). (3) VARIASI dari konten sebelumnya - lihat distribusi pilar/" +
    "angle di atas, ide yg mengisi kekosongan dapat skor lebih tinggi drpd yg mengulang " +
    "yg sudah banyak. (4) DUKUNGAN KEYWORD PRIORITAS - ide yg menargetkan keyword " +
    "Level 1/2 yg masih under-served dapat skor lebih tinggi. Sertakan jg reasoning " +
    "SINGKAT (1 kalimat, Bahasa Indonesia) kenapa skor itu diberikan - WAJIB jujur & " +
    "spesifik (mis. \"skor tinggi krn isi kekosongan pilar Kuliner Sekitar & keyword " +
    "Level 1 blm pernah dipakai\", atau \"pilar Wisata Sekitar terbukti performa tinggi " +
    "dari data views nyata\"), bukan pujian generik. " +
    // 3 tipe (2026-08-05, revisi Agus - awalnya 2 tipe "video"/"carousel" [carousel
    // sebenarnya berarti foto tunggal], sekarang dipisah eksplisit jadi 3: video, foto
    // tunggal (poster), carousel BENERAN multi-foto).
    `Sertakan jg contentType ("video", "foto", atau "carousel") - dari ${count} ide, TEPAT ` +
    `${videoCount} harus "video", TEPAT ${fotoCount} harus "foto", TEPAT ${carouselCount} ` +
    `harus "carousel" (JANGAN meleset dari angka ini). Pilih ide MANA yg cocok jadi apa: ` +
    "\"video\" = butuh gerakan/proses/beberapa momen berurutan (mis. tur kamar, aktivitas, " +
    "perbandingan). \"foto\" = SATU momen visual kuat yg cukup diwakili 1 gambar diam (mis. " +
    "highlight 1 fasilitas spesifik, 1 sudut estetik, promo harga simpel) - jadi POSTER " +
    "promosi tunggal. \"carousel\" = topik yg BENAR-BENAR butuh BEBERAPA foto berurutan utk " +
    "cerita lengkap (mis. tur beberapa sudut kamar sekaligus, beberapa fasilitas berbeda " +
    "dalam 1 post, before/after, beberapa menu/pilihan) - BUKAN cuma 1 foto yg dibagi jadi " +
    "beberapa slide tanpa alasan, harus ada alasan NYATA butuh multi-foto. JANGAN asal bagi " +
    "rata, pilih yg PALING NATURAL utk tiap format.";
  const scoredUser =
    `${user}${performanceBlock}\n\nBalas HARUS JSON valid (tanpa markdown code fence): ` +
    `{"ideas": [{"idea": "...", "score": 0, "reasoning": "...", "contentType": "video"}, ...]}`;

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: scoredSystem },
      { role: "user", content: scoredUser },
    ],
    temperature: 0.8,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "{}";
  const cleaned = raw.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
  const parsed = JSON.parse(cleaned);
  const rawIdeas: unknown[] = Array.isArray(parsed.ideas) ? parsed.ideas : [];
  const scored: ScoredIdea[] = rawIdeas
    .filter((i): i is { idea: string; score: number; reasoning: string; contentType?: unknown } =>
      !!i && typeof i === "object" && typeof (i as Record<string, unknown>).idea === "string"
    )
    .map((i) => ({
      idea: i.idea,
      score: Math.max(0, Math.min(100, Math.round(Number(i.score) || 0))),
      reasoning: typeof i.reasoning === "string" ? i.reasoning : "",
      contentType:
        i.contentType === "carousel" ? ("carousel" as const) :
        i.contentType === "foto" ? ("foto" as const) :
        ("video" as const),
    }));

  const filteredIdeaTexts = new Set(filterRestricted(scored.map((s) => s.idea)));
  const filtered = scored.filter((s) => filteredIdeaTexts.has(s.idea));
  return enforceContentTypeSplit(filtered, videoCount, fotoCount, carouselCount).sort((a, b) => b.score - a.score);
}

// Jaring pengaman KODE (2026-08-05) - GPT sering meleset hitung jumlah exact dari
// instruksi teks (bug class yg sama berulang sesi ini: model "hampir benar" tapi
// tidak bisa diandalkan 100% utk aritmatika sederhana). Kalau split hasil GPT tidak
// PERSIS videoCount/fotoCount/carouselCount, koreksi deterministik: pindahkan ide dgn
// SKOR TERENDAH dari kategori kelebihan ke kategori kekurangan, sampai pas - bukan
// panggil API lagi (lebih cepat & pasti berhasil). Diperluas dari 2 tipe ke 3 (2026-08-05).
function enforceContentTypeSplit(ideas: ScoredIdea[], videoCount: number, fotoCount: number, carouselCount: number): ScoredIdea[] {
  const result = [...ideas];
  const total = videoCount + fotoCount + carouselCount;
  if (result.length !== total) return result; // filterRestricted bisa kurangi jumlah - jangan paksa split kalau total sudah beda

  const targets: Record<ScoredIdea["contentType"], number> = { video: videoCount, foto: fotoCount, carousel: carouselCount };
  const buckets: Record<ScoredIdea["contentType"], ScoredIdea[]> = {
    video: result.filter((i) => i.contentType === "video").sort((a, b) => a.score - b.score),
    foto: result.filter((i) => i.contentType === "foto").sort((a, b) => a.score - b.score),
    carousel: result.filter((i) => i.contentType === "carousel").sort((a, b) => a.score - b.score),
  };
  const types: ScoredIdea["contentType"][] = ["video", "foto", "carousel"];

  // Loop sampai semua bucket pas dgn targetnya - pindahkan skor terendah dari bucket
  // KELEBIHAN ke bucket manapun yg KEKURANGAN, urutan tidak masalah selama target
  // masing2 akhirnya pas persis (beda dari versi 2-tipe yg cuma py 1 arah pindah).
  let progress = true;
  while (progress) {
    progress = false;
    for (const from of types) {
      if (buckets[from].length <= targets[from]) continue;
      const to = types.find((t) => buckets[t].length < targets[t]);
      if (!to) continue;
      const moved = buckets[from].shift();
      if (!moved) continue;
      moved.contentType = to;
      buckets[to].push(moved);
      progress = true;
    }
  }
  return [...buckets.video, ...buckets.foto, ...buckets.carousel];
}
