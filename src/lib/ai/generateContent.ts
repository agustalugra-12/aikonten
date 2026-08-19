import { getOpenAIClient } from "./openaiClient";
import type { ScoredSegment } from "./clipSelect";
import type { TranscriptSegment } from "./transcribe";
import { fetchPelangiKnowledge, mergeManualKnowledge } from "./pelangiKnowledge";
import { KEYWORD_PRIORITY_LIST } from "./keywordPriority";
import {
  pickLeastUsedTemplate,
  pickUnderusedContentType,
  buildHookAvoidInstruction,
  buildContentTypeAvoidInstruction,
  buildPillarAvoidInstruction,
  getRecentStructureAndHookUsage,
  getRecentContentTypeUsage,
  getRecentPillarUsage,
  isContentTypeOverused,
  type StructureHookUsage,
  type ContentTypeUsage,
} from "./contentVariety";
import { getActiveContentTypes, getCompatibleStructures } from "./contentTypeUtils";

// Normalisasi hashtag (2026-08-05, bug nyata dilaporkan Agus - hashtag tampil "##").
// Prompt di bawah tidak menegaskan ADA/TIDAKnya "#" di tiap item array, jadi GPT kadang
// balas sudah pakai "#" sendiri (mis. "#PelangiHomestay") - kode pemakai (orchestrate.ts
// publish, DraftReview.tsx preview) SELALU nambahin "#" lagi krn asumsinya array isi kata
// polos, jadi jadi "##PelangiHomestay". Buang "#" di depan di sini (SATU tempat, dipakai
// kedua fungsi di bawah) - array yang di-return ke pemakai lain SELALU kata polos tanpa
// "#", apa pun yang dibalas GPT.
function stripHashPrefix(tags: string[]): string[] {
  return tags.map((t) => t.replace(/^#+/, ""));
}

// Batas KERAS 5 hashtag (2026-08-06, permintaan Agus - "perbaiki untuk hastag maksimal 5
// saja") - instruksi prompt SUDAH minta maks 5 di kedua fungsi di bawah, TAPI model tidak
// selalu patuh persis (pola sama yg berulang kali ditemukan sesi ini - prompt saja tidak
// 100% reliable utk batas angka pasti) - dipotong di sini SEBAGAI jaring pengaman kode,
// bukan cuma andalkan instruksi. Ambil 5 PERTAMA (model biasanya taruh yg paling relevan
// duluan), bukan random slice.
function capHashtags(tags: string[], max: number = 5): string[] {
  return tags.slice(0, max);
}

// Content Pillar & Duplicate Checker (2026-08-05, PRD "AI Content Brain" modul 6 & 11,
// permintaan Agus) - target komposisi Pelangi Homestay 40% / Wisata Sekitar 25% / Tips
// Liburan Bedugul 15% / Kuliner Sekitar 10% / Travel Tips 10% (angka dari PRD Agus
// persis). "angle" - sudut pandang konten (harga/lokasi/fasilitas/dst) - dipakai
// dailyContentPlanner.ts liat distribusi ASLI konten yg SUDAH dibuat (bukan cuma tebak
// dari teks skrip mentah), supaya ide/pilar berikutnya diarahkan ke yg jarang dipakai.
//
// pillarsForSite() (2026-08-10, bug nyata dilaporkan Agus - "AI konten di Animal Story
// & Co bisa buat konten tentang homestay, harusnya buat konten berdasarkan akunnya") -
// SEBELUM ini 5 pilar di bawah dipakai HARDCODE utk SEMUA brand tanpa pandang bulu
// (sama root cause dgn bug knowledgeSite yg sudah diperbaiki 2026-08-06, kali ini di
// sistem klasifikasi pilar bukan knowledge base) - brand non-hospitality (Animal Story
// & Co, laundry in bali) tetap diklasifikasi/didorong ke arah pilar "Pelangi Homestay"
// krn itu satu2nya pilihan yg ditawarkan ke model. Sekarang HANYA brand knowledgeSite
// "pelangi" (satu2nya brand yg benar2 pakai 5 pilar ini) yg dapat daftar lama PERSIS
// (zero behavior change) - brand lain dapat GENERIC_PILLARS, pilar universal yg masuk
// akal utk bisnis apa pun.
export const PELANGI_PILLARS = [
  "Pelangi Homestay", "Wisata Sekitar", "Tips Liburan Bedugul", "Kuliner Sekitar", "Travel Tips",
] as const;
const PELANGI_PILLAR_TARGET_PERCENT: Record<string, number> = {
  "Pelangi Homestay": 40, "Wisata Sekitar": 25, "Tips Liburan Bedugul": 15, "Kuliner Sekitar": 10, "Travel Tips": 10,
};
export const GENERIC_PILLARS = ["Edukasi", "Promosi", "Hiburan/Engagement", "Testimoni"] as const;

// Content Pillar Override (2026-08-11, permintaan Agus - brand "laundry in bali" & jg
// Pelangi Homestay: "aku mau kembangkan jenis kontennya ada konten edukasi dan tips...
// jangan menghapus content pillar lama"). customPillarsJson = brands.contentPillars
// (JSON `{pillars: string[], targetPercent: Record<string, number>}`, lihat schema.ts).
// KALAU brand py override, dipakai APA ADANYA (brand itu penuh kendali isi listnya -
// staf/Agus yg menulis JSON-nya SUDAH menyertakan pillar LAMA + BARU sekaligus di sana,
// bukan cuma yg baru, supaya pillar lama tetap ada di daftar - lihat contoh nyata yg
// ditulis ke DB utk Laundry/Pelangi). Brand TANPA override (null/kosong) - perilaku
// LAMA PERSIS (Pelangi hardcode / generic 4-pillar), TIDAK terpengaruh sama sekali.
function parseCustomPillars(customPillarsJson?: string | null): { pillars: string[]; targetPercent: Record<string, number> } | null {
  if (!customPillarsJson) return null;
  try {
    const parsed = JSON.parse(customPillarsJson);
    if (!Array.isArray(parsed.pillars) || parsed.pillars.length === 0) return null;
    return { pillars: parsed.pillars, targetPercent: parsed.targetPercent || {} };
  } catch {
    return null; // JSON rusak - fallback ke perilaku lama, bukan gagalkan generate
  }
}

export function pillarsForSite(knowledgeSite?: string | null, customPillarsJson?: string | null): readonly string[] {
  const custom = parseCustomPillars(customPillarsJson);
  if (custom) return custom.pillars;
  return knowledgeSite === "pelangi" ? PELANGI_PILLARS : GENERIC_PILLARS;
}
export function pillarTargetPercentForSite(knowledgeSite?: string | null, customPillarsJson?: string | null): Record<string, number> {
  const custom = parseCustomPillars(customPillarsJson);
  if (custom) {
    if (Object.keys(custom.targetPercent).length > 0) return custom.targetPercent;
    const equal = Math.round(100 / custom.pillars.length);
    return Object.fromEntries(custom.pillars.map((p) => [p, equal]));
  }
  if (knowledgeSite === "pelangi") return PELANGI_PILLAR_TARGET_PERCENT;
  const pillars = GENERIC_PILLARS;
  const equal = Math.round(100 / pillars.length);
  return Object.fromEntries(pillars.map((p) => [p, equal]));
}

export const CONTENT_ANGLES = [
  "harga", "lokasi", "fasilitas", "suasana", "target_tamu", "momen", "faq", "perbandingan",
] as const;
export type ContentAngle = (typeof CONTENT_ANGLES)[number];

// Pillar TIDAK LAGI divalidasi ke daftar tetap (2026-08-10) - daftar yg ditawarkan ke
// model sekarang beda per brand (lihat pillarsForSite di atas), jadi validasi ketat ke
// SATU daftar literal sudah tidak masuk akal - cukup terima string non-kosong apa pun
// yg dibalas model (kolom DB sendiri TEXT polos, tidak ada constraint enum sungguhan).
function normalizePillar(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 60) : null;
}
function normalizeAngle(v: unknown): ContentAngle | null {
  return (CONTENT_ANGLES as readonly string[]).includes(v as string) ? (v as ContentAngle) : null;
}
// Hook Type Library (2026-08-14, PRD "AI Content Intelligence" Fase 1) - 11 kategori
// hook TETAP (bukan per-brand spt pillar - kategori pembuka konten itu domain-agnostic,
// beda dari pillar yg legitimately beda per bisnis). Tracking-only (dipakai deteksi
// pengulangan di contentVariety.ts), TIDAK membatasi model menulis hook bebas apa pun -
// klasifikasi ini SETELAH model menulis, bukan sebelum.
export const HOOK_TYPES = [
  "curiosity", "problem", "contrarian", "question", "story", "data", "warning",
  "direct_benefit", "mystery", "comparison", "pattern_interrupt",
] as const;
export type HookType = (typeof HOOK_TYPES)[number];

function normalizeHookType(v: unknown): HookType | null {
  return (HOOK_TYPES as readonly string[]).includes(v as string) ? (v as HookType) : null;
}

// Caption Style Rotation (PRD §41) - variasi gaya caption supaya tidak monoton.
// Sama pola dgn HOOK_TYPES: daftar tetap + normalisasi + tracking usage.
export const CAPTION_STYLES = [
  "storytelling", "educational", "short", "conversational", "question",
  "authority", "product", "emotional", "seo", "cta_focused",
] as const;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];

function normalizeCaptionStyle(v: unknown): CaptionStyle | null {
  return (CAPTION_STYLES as readonly string[]).includes(v as string) ? (v as CaptionStyle) : null;
}

// Content Type validation (2026-08-14, TIER 1) - TIDAK validasi ke daftar tetap seperti
// HOOK_TYPES/CONTENT_ANGLES, krn content_types adalah TABLE extensible (bisa INSERT type
// baru tanpa code change). Validasi cuma format: string non-kosong yg match pattern ID
// "ct_*". Caller (processProject.ts) akan verify FK existence saat persist ke DB - kalau
// GPT return ID yg tidak exist di content_types table, INSERT akan gagal & caught, project
// tetap lanjut dgn contentTypeId=null (fail-soft, tidak ganggu pillar/angle/hookType).
function normalizeContentType(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  // Accept any string that looks like a content type ID (ct_*)
  // DB FK constraint will enforce actual existence
  const normalized = v.trim();
  if (normalized.startsWith("ct_") && normalized.length > 3) {
    return normalized;
  }
  return null;
}
// Keyword Priority & Search Intent (2026-08-05, PRD modul 4 & 9) - normalisasi longgar
// (bandingkan case-insensitive) krn keyword ASLI (bukan enum ketat spt pillar/angle) -
// GPT kadang beda kapitalisasi kecil, tetap dianggap valid selama cocok satu daftar.
function normalizeTargetKeyword(v: unknown): { targetKeyword: string | null; keywordLevel: number | null } {
  if (typeof v !== "string" || !v.trim()) return { targetKeyword: null, keywordLevel: null };
  const match = KEYWORD_PRIORITY_LIST.find((k) => k.keyword.toLowerCase() === v.trim().toLowerCase());
  return match ? { targetKeyword: match.keyword, keywordLevel: match.level } : { targetKeyword: null, keywordLevel: null };
}

// Jadi fungsi (2026-08-10, bug pilar hardcode - lihat catatan pillarsForSite di atas) -
// daftar pillar & instruksi targetKeyword sekarang tergantung knowledgeSite brand ini
// (targetKeyword daftar Level 1/2/3 itu SEO Bedugul-spesifik, tidak masuk akal disodorkan
// ke brand yg sama sekali bukan properti Bedugul).
function buildClassificationFragment(knowledgeSite?: string | null, customPillarsJson?: string | null): string {
  const pillars = pillarsForSite(knowledgeSite, customPillarsJson);
  const keywordPart =
    knowledgeSite === "pelangi"
      ? " Sertakan juga targetKeyword: SALAH SATU PERSIS dari daftar keyword " +
        `prioritas ini kalau konten ini benar2 menargetkannya (${KEYWORD_PRIORITY_LIST.map((k) => `"${k.keyword}"`).join(", ")}), ` +
        "atau null kalau konten ini tidak spesifik menargetkan salah satu keyword itu (JANGAN " +
        "dipaksakan kalau memang tidak relevan)."
      : "";
  // Content Type classification (2026-08-14, TIER 1) - FORMAT konten (Educational, How-to,
  // Listicle, dst), BUKAN business topic (itu pillar). Sistem types: ct_educational,
  // ct_howto, ct_listicle, ct_storytelling, ct_problem_solution, ct_myth_fact, ct_comparison,
  // ct_case_study, ct_behind_scenes, ct_product_showcase, ct_testimonial, ct_faq, ct_trend,
  // ct_ugc, ct_promotional, ct_community. OPSIONAL (boleh null kalau genuinely tidak cocok
  // kategori mana pun) - TIDAK memblokir generation kalau tidak yakin.
  const contentTypeHint =
    " Sertakan juga contentType: ID salah satu dari ct_educational (konten edukatif), " +
    "ct_howto (tutorial langkah-demi-langkah), ct_listicle (daftar/tips), ct_storytelling (cerita/narasi), " +
    "ct_problem_solution (identifikasi masalah & solusi), ct_myth_fact (bongkar mitos), " +
    "ct_comparison (bandingkan opsi), ct_case_study (contoh nyata/hasil), ct_behind_scenes (proses/persiapan), " +
    "ct_product_showcase (tampilkan produk/layanan), ct_testimonial (review/testimoni), ct_faq (jawab pertanyaan umum), " +
    "ct_trend (ikuti/respons tren), ct_ugc (gaya user-generated), ct_promotional (promosi langsung), " +
    "ct_community (bangun komunitas/engagement), atau null kalau tidak cocok kategori mana pun.";
  
  return (
    ` Sertakan juga pillar (WAJIB SALAH SATU PERSIS): ${pillars.map((p) => `"${p}"`).join(", ")}, ` +
    `angle (WAJIB SALAH SATU PERSIS): ${CONTENT_ANGLES.map((a) => `"${a}"`).join(", ")}, ` +
    `dan hookType (WAJIB SALAH SATU PERSIS): ${HOOK_TYPES.map((h) => `"${h}"`).join(", ")} - ` +
    "klasifikasi kategori hook/pembuka yang BENAR-BENAR dipakai di skrip/caption ini - " +
    "klasifikasi ini dipakai sistem melacak variasi konten, JAWAB SEJUJURNYA sesuai isi konten ini, " +
    "bukan asal pilih." +
    ` dan captionStyle (WAJIB SALAH SATU PERSIS): ${CAPTION_STYLES.map((s) => `"${s}"`).join(", ")} - ` +
    "klasifikasi gaya penulisan caption yang BENAR-BENAR dipakai di konten ini." +
    contentTypeHint +
    keywordPart
  );
}

export type GeneratedContent = {
  caption: string;
  hashtags: string[];
  pillar: string | null;
  angle: ContentAngle | null;
  hookType: HookType | null;
  captionStyle: CaptionStyle | null;
  contentType: string | null;
  targetKeyword: string | null;
  keywordLevel: number | null;
  knowledgeUsed: string;
};

export type GeneratedImageContent = GeneratedContent & {
  // Teks harga/promo singkat kalau skrip menyebutkannya (mis. "Rp175.000", "Promo 20%"),
  // null kalau tidak ada - informasional (dulu dipakai badge overlay terpisah, sekarang
  // harga sudah masuk desain poster penuh lewat PosterCopy.harga, lihat processProject.ts
  // & posterDesign.ts). Deteksi ini SENGAJA tetap jadi bagian sama panggilan GPT ini
  // (bukan panggilan terpisah) biar hemat & konsisten dgn konteks yg sama persis dgn
  // caption - dipertahankan di response API utk visibilitas, bukan dipakai render lagi.
  promoText: string | null;
};

export type GeneratedVideoContent = GeneratedContent & {
  // Keyword Inggris singkat utk cari B-roll di Pexels (mis. "tropical bedroom
  // interior") - null kalau topiknya tidak cocok disandingkan stok footage generik.
  // Bahasa Inggris krn metadata Pexels mayoritas Inggris, hasil jauh lebih relevan drpd
  // query Bahasa Indonesia.
  brollKeywords: string | null;
  // Teks hook singkat (2-5 kata) utk thumbnail YouTube (lihat thumbnail.ts) - cuma
  // dipakai kalau brand ini punya akun YouTube tersambung (lihat process/route.ts),
  // tapi tetap di-generate di sini skalian biar hemat 1 panggilan GPT terpisah.
  thumbnailText: string | null;
  // Nama template struktur narasi yg dipakai (lihat VIDEO_STRUCTURE_TEMPLATES) - murni
  // informasional (biar Agus bisa lihat variasi apa yg kepakai tiap video), tidak
  // dipakai logic lain.
  structureTemplate: string;
};

// Struktur narasi video (2026-08-05, permintaan Agus - "aku mau ada hook, peak,
// fasilitas, cta atau kamu berikan beberapa struktur vidio juga agar ada referensi
// utk ai dan tidak monoton"). Caption YANG DIHASILKAN = naskah voiceover TTS (lihat
// dubbing.ts, GANTI TOTAL audio asli) - jadi "struktur video" di sini diterapkan lewat
// STRUKTUR NASKAHNYA, bukan cuma urutan klip visual (urutan klip visual: hook=klip skor
// tertinggi taruh pertama, fasilitas=klip asli lain, peak=klip Pexels landmark, lihat
// processProject.ts). Dipilih ACAK tiap generate (bukan selalu template pertama) supaya
// video-video yg dibuat tidak terasa monoton/rumus yg sama persis berulang-ulang.
export const VIDEO_STRUCTURE_TEMPLATES: { name: string; guide: string }[] = [
  {
    name: "Hook-Peak-Fasilitas-CTA",
    guide:
      "1) HOOK: 1 kalimat pembuka yg menggugah rasa penasaran/relate ke audiens (JANGAN " +
      "langsung sebut nama properti di kalimat pertama). 2) PEAK: momen/suasana paling " +
      "aspirational dari topik (destinasi/pemandangan/pengalaman puncak). 3) FASILITAS: " +
      "highlight 2-3 fasilitas/kenyamanan konkret dari properti. 4) CTA: ajakan spesifik " +
      "menutup caption.",
  },
  {
    name: "Problem-Solution-Fasilitas-CTA",
    guide:
      "1) PROBLEM: buka dgn masalah/keresahan yg relate (mis. capek kerja, butuh healing, " +
      "susah cari penginapan yg pas). 2) SOLUTION: perkenalkan properti sbg jawabannya. " +
      "3) FASILITAS: bukti konkret kenyamanan/fasilitas yg jadi solusi. 4) CTA.",
  },
  {
    name: "POV-Fasilitas-Suasana-CTA",
    guide:
      "1) POV/DAY-IN-LIFE: bawa audiens ikut merasakan momen datang & menikmati tempatnya " +
      "(gaya naratif orang pertama/mengajak). 2) FASILITAS: tunjukkan momen menikmati " +
      "kamar/fasilitas. 3) SUASANA: tenang/asri/alam sekitar. 4) CTA.",
  },
  {
    name: "Compare-Fasilitas-Promo-CTA",
    guide:
      "1) HOOK KONTRAS: buka dgn perbandingan/keluhan umum (mis. penginapan mahal tapi " +
      "biasa saja). 2) FASILITAS: buktikan value/kelebihan nyata. 3) HARGA/PROMO: sebut " +
      "kalau relevan dari skrip. 4) CTA.",
  },
  {
    name: "Montase-Fasilitas-CTA",
    guide:
      "1) MONTASE HOOK: beberapa highlight singkat beruntun, nada energik/cepat. " +
      "2) FASILITAS: highlight utama yg paling menjual. 3) CTA singkat & tegas, tanpa " +
      "basa-basi panjang.",
  },
];

// Knowledge Base grounding (2026-08-05, permintaan Agus - sama alasannya dgn
// researchTopics.ts: "supaya konteks konten tidak keluar jalur") - dipakai caption/
// hashtag generation JUGA (bukan cuma ide), krn instruksi "JANGAN mengarang fasilitas"
// yg sudah ada di system prompt SEBELUMNYA tidak py data ASLI apa pun utk dicocokkan -
// cuma janji tanpa pegangan. Return string kosong kalau knowledge base belum
// terkonfigurasi (fetchPelangiKnowledge sendiri sudah aman gagal-diam, lihat sana).
//
// `knowledgeSite || "pelangi"` DIHAPUS (2026-08-06, bug nyata ditemukan langsung dari
// laporan Agus - brand baru "laundry in bali", TIDAK ADA hubungannya dgn Pelangi/Harmoni,
// tetap dapat fakta kamar/harga Pelangi Homestay krn field ini default diam-diam ke
// "pelangi" kalau brand belum eksplisit pilih). Brand TANPA knowledgeSite (null/kosong -
// bukan cuma brand baru, tapi juga brand yg sengaja tidak terkait properti manapun) SEKARANG
// dilewati sama sekali (no auto-grounding), BUKAN diam-diam ambil fakta Pelangi.
async function buildKnowledgeGroundingBlock(
  knowledgeSite?: string | null,
  manualKnowledge?: string | null
): Promise<{ instruction: string; contextBlock: string; knowledge: string }> {
  const autoKnowledge = knowledgeSite ? await fetchPelangiKnowledge(knowledgeSite) : "";
  const knowledge = mergeManualKnowledge(autoKnowledge, manualKnowledge);
  if (!knowledge) return { instruction: "", contextBlock: "", knowledge: "" };
  return {
    knowledge,
    instruction:
      " KAMU PUNYA KNOWLEDGE BASE ASLI PROPERTI DI KONTEKS - SEMUA klaim fasilitas/harga " +
      "WAJIB berasal dari situ, dan kalau Knowledge Base eksplisit bilang properti TIDAK " +
      "punya sesuatu (mis. kolam renang/rental motor/jemput bandara/ruang meeting), JANGAN " +
      "PERNAH tulis caption yg mengklaim/menyiratkan itu ada.",
    contextBlock: `\n\n# KNOWLEDGE BASE ASLI PROPERTI\n${knowledge}\n`,
  };
}

// Struktur narasi LONG-FORM (2026-08-06, permintaan Agus - "vidio panjang untuk yt ada
// durasi 3 mnit 5 mnit dan 8 manit") - template pendek di atas ("montase highlight
// singkat beruntun") secara struktural TIDAK bisa direnggangkan jadi naskah 8 menit
// tanpa jadi bertele-tele/pengulangan - butuh LEBIH BANYAK section berisi supaya
// elaborasinya organik (tiap section py sesuatu KONKRET utk dibahas, bukan cuma
// kalimat sama diulang-ulang), bukan cuma "tulis section yg sama tapi lebih panjang".
const LONG_FORM_STRUCTURE_TEMPLATES: { name: string; guide: string }[] = [
  {
    name: "LongForm-Hook-Perkenalan-Fasilitas-Kamar-Sekitar-Testimoni-FAQ-CTA",
    guide:
      "1) HOOK: buka dgn pertanyaan/keresahan yg relate audiens ttg cari penginapan yg " +
      "pas (JANGAN langsung sebut nama properti di kalimat pertama). 2) PERKENALAN: " +
      "kenalkan properti & lokasinya scr umum. 3) FASILITAS: bahas fasilitas utama SATU " +
      "PER SATU scr detail & konkret (bukan cuma daftar kata). 4) TIPE KAMAR: bahas " +
      "pilihan tipe kamar yg tersedia & bedanya. 5) SEKITAR: apa yg menarik di sekitar " +
      "properti (wisata/kuliner terdekat kalau relevan dari skrip). 6) KENAPA PILIH " +
      "PROPERTI INI: rangkum value/kelebihan dibanding penginapan lain scr umum. 7) CTA " +
      "penutup yg jelas.",
  },
  {
    name: "LongForm-POV-Kedatangan-Kamar-Fasilitas-Aktivitas-Malam-CTA",
    guide:
      "1) POV/DAY-IN-LIFE: bawa audiens ikut merasakan momen datang scr naratif orang " +
      "pertama/mengajak. 2) KEDATANGAN: suasana check-in & first impression. 3) KAMAR: " +
      "eksplorasi detail kamar & kenyamanannya. 4) FASILITAS: eksplorasi fasilitas lain " +
      "satu per satu. 5) AKTIVITAS: apa yg bisa dilakukan tamu selama menginap. 6) " +
      "SUASANA MALAM/SANTAI: momen relaks di properti. 7) CTA penutup.",
  },
];

function pickStructureTemplate(
  target: number,
  structureCounts: Map<string, number>,
  avoidNames: string[] = [],
  compatibleNames: string[] = []
): { name: string; guide: string } {
  // >=180dtk (3 menit) dianggap long-form - lihat catatan LONG_FORM_STRUCTURE_TEMPLATES.
  const fullPool = target >= 180 ? LONG_FORM_STRUCTURE_TEMPLATES : VIDEO_STRUCTURE_TEMPLATES;
  // TIER 3 - filter struktur oleh compatibility content type (dari content_types
  // table metadata) kalau tersedia. Fallback ke pool penuh kalau compatible kosong
  // (mis. metadata belum diisi / pool structure kecil) - jangan pernah pool kosong.
  const compatPool = compatibleNames.length > 0
    ? fullPool.filter((t) => compatibleNames.includes(t.name))
    : fullPool;
  const usable = compatPool.length > 0 ? compatPool : fullPool;
  // Regenerasi (2026-08-14, lihat processProject.ts) bisa minta struktur TERTENTU
  // dikecualikan (yg baru saja terbukti overused percobaan sebelumnya) - fallback ke
  // pool penuh kalau exclude menghabiskan semua opsi (jangan pernah pool kosong).
  const pool = usable.filter((t) => !avoidNames.includes(t.name));
  return pickLeastUsedTemplate(pool.length > 0 ? pool : usable, structureCounts);
}

// Kecepatan bicara TTS acuan ~150 kata/menit (2,5 kata/detik) - dipakai kasih target
// jumlah kata eksplisit ke GPT supaya naskah voiceover BENERAN sepanjang durasi video
// (2026-08-06). SEBELUMNYA prompt cuma bilang "caption ini jadi naskah TTS" tanpa target
// panjang APA PUN - utk video pendek (30-90dtk) caption "natural" GPT kebetulan sering
// cukup, tapi target 480dtk (8 menit) butuh ~1200 kata & GPT TIDAK akan otomatis
// menulis sepanjang itu tanpa diminta eksplisit - hasilnya voiceover berhenti jauh
// sebelum video selesai (audio TTS habis, sisa durasi video jadi bisu).
const WORDS_PER_SECOND = 2.5;

export async function generateCaptionAndHashtags(
  brandName: string,
  script: string,
  selectedClipsText: string,
  knowledgeSite?: string | null,
  manualKnowledge?: string | null,
  videoDurationTarget: number = 60,
  customPillarsJson?: string | null,
  brandId?: string | null,
  avoidStructureNames: string[] = [],
  avoidHookTypes: string[] = [],
  avoidContentTypes: string[] = [],
  avoidHashtags: string[] = [],
  avoidCaptionStyles: string[] = []
): Promise<GeneratedVideoContent> {
  const client = getOpenAIClient();
  // usage kosong (brand belum diketahui, mis. dipanggil dari konteks tanpa brandId) -
  // fallback aman: semua count 0, pickLeastUsedTemplate/buildHookAvoidInstruction tetap
  // jalan normal (random di antara SEMUA template, tidak ada avoid-instruction).
  const usage: StructureHookUsage = brandId
    ? await getRecentStructureAndHookUsage(brandId)
    : { structureCounts: new Map(), hookTypeCounts: new Map() };
  // Content type usage (TIER 1+2) — NULL contentTypeId di-filter di query.
  const contentTypeUsage: ContentTypeUsage = brandId
    ? await getRecentContentTypeUsage(brandId)
    : { typeCounts: new Map() };

  // TIER 3 - Weighted content type selection (bukan Math.random).
  // Pilih content type yg paling underused/least-used dari daftar ACTIVE types
  // (extensible dari content_types table, bukan enum hardcode). Exclude yang sudah
  // di-avoid (terbukti overused di percobaan regen sebelumnya). Kalau semua overused
  // (brand dgn topik sempit), fallback ke semua active types - TIDAK pernah kosong.
  let preferredContentType: string | null = null;
  if (brandId) {
    const activeTypes = await getActiveContentTypes();
    if (activeTypes.length > 0) {
      const eligible = activeTypes.filter((t) => !avoidContentTypes.includes(t.id) && !isContentTypeOverused(t.id, contentTypeUsage));
      const pool = eligible.length > 0 ? eligible : activeTypes;
      const picked = pickUnderusedContentType(pool, contentTypeUsage.typeCounts);
      preferredContentType = picked.id;
    }
  }

  // TIER 3 - Struktur difilter oleh kompatibilitas content type yg dipilih di atas
  // (metadata compatible_structures di content_types). Fallback ke semua struktur
  // kalau metadata kosong / struktur tidak compatible.
  const compatibleNames = preferredContentType
    ? await getCompatibleStructures(preferredContentType)
    : [];
  const structureTemplate = pickStructureTemplate(videoDurationTarget, usage.structureCounts, avoidStructureNames, compatibleNames);

  const hookAvoidInstruction =
    buildHookAvoidInstruction(usage.hookTypeCounts) +
    (avoidHookTypes.length > 0
      ? ` Hook type "${avoidHookTypes.join(", ")}" TERBUKTI masih terlalu sering dipakai di percobaan sebelumnya - WAJIB pilih tipe hook LAIN kali ini.`
      : "");
  const contentTypeAvoidInstruction =
    buildContentTypeAvoidInstruction(contentTypeUsage.typeCounts) +
    (avoidContentTypes.length > 0
      ? ` Content type "${avoidContentTypes.join(", ")}" TERBUKTI masih terlalu sering dipakai di percobaan sebelumnya - WAJIB pilih content type LAIN kali ini.`
      : "") +
    (preferredContentType
      ? ` Untuk menjaga variasi konten, prioritaskan content type ${preferredContentType} KALAU memang cocok dgn isi konten ini (jangan dipaksakan kalau benar2 tidak pas).`
      : "");
  const captionStyleAvoidInstruction =
    avoidCaptionStyles.length > 0
      ? ` Caption style "${avoidCaptionStyles.join(", ")}" sudah terlalu sering dipakai - WAJIB pilih gaya caption LAIN kali ini.`
      : "";
  // Pillar Target Enforcement (2026-08-19, bug nyata ditemukan Agus - "Pelangi 100%
  // numpuk 1 pilar, 0% Edukasi" walau targetPercent sudah dikonfigurasi) - lihat catatan
  // lengkap di contentVariety.ts. pillarTargetPercentForSite SUDAH ada & dipanggil
  // researchTopics.ts (bias saran ide), TAPI baru sekarang JUGA dipakai di titik
  // klasifikasi FINAL ini - itu celah yg ditutup di sini, bukan bikin mekanisme baru.
  const { counts: pillarUsageCounts, windowSize: pillarWindowSize } = brandId
    ? await getRecentPillarUsage(brandId)
    : { counts: new Map<string, number>(), windowSize: 0 };
  const pillarTargetPercent = pillarTargetPercentForSite(knowledgeSite, customPillarsJson);
  const pillarAvoidInstruction = buildPillarAvoidInstruction(pillarUsageCounts, pillarTargetPercent, pillarWindowSize);
  const grounding = await buildKnowledgeGroundingBlock(knowledgeSite, manualKnowledge);
  const targetWords = Math.round(videoDurationTarget * WORDS_PER_SECOND);
  const isLongForm = videoDurationTarget >= 180;
  const lengthInstruction = isLongForm
    ? ` Video ini TARGET DURASI ${videoDurationTarget} detik (${Math.round(videoDurationTarget / 60)} menit) - ` +
      `caption/naskah voiceover WAJIB SEKITAR ${targetWords} KATA (boleh meleset sedikit, tapi JANGAN jauh ` +
      "lebih pendek) supaya voiceover TTS mengisi penuh durasi video, TIDAK berhenti di tengah lalu sisa " +
      "video jadi bisu. Elaborasi tiap bagian struktur dgn detail KONKRET dari Knowledge Base/skrip/klip " +
      "(bukan basa-basi/pengulangan kalimat yg sama dgn kata beda) - kalau suatu bagian tidak ada bahan " +
      "konkretnya di Knowledge Base/skrip, persingkat bagian itu drpd mengarang, tapi kompensasi dgn " +
      "elaborasi lebih dalam di bagian LAIN yg memang ada bahannya, supaya total tetap dekati target kata."
    : ` Caption/naskah voiceover sekitar ${targetWords} kata, singkat & padat (video pendek ${videoDurationTarget} detik).`;
  const system =
    "Kamu content strategist media sosial. Buat caption yang menarik & natural (bukan " +
    "generik/template) plus MAKSIMAL 5 hashtag PALING relevan (bukan lebih - pilih yg " +
    "paling tepat sasaran, jangan asal banyak) berdasarkan skrip & isi klip yang " +
    "benar-benar terpilih. JANGAN mengarang klaim yang tidak ada di skrip/klip. " +
    "KALAU skrip ini berisi TIPS/CARA/LANGKAH konkret (bukan cuma cerita/promosi biasa), " +
    "caption WAJIB memuat SEMUA poin/langkah tipsnya secara LENGKAP - JANGAN cuma " +
    "disebut sepintas/dijadikan teaser yg mengarahkan ke tempat lain, penonton harus " +
    "dapat SELURUH isi tipsnya langsung dari caption ini." +
    grounding.instruction +
    " Caption ini JUGA jadi naskah voiceover (dibacakan TTS, GANTI TOTAL audio asli video) - " +
    `WAJIB ikuti struktur narasi berikut (jangan tulis label section-nya literal, cukup ` +
    `alirkan sbg 1 caption utuh yg mengikuti urutan ide ini): ${structureTemplate.guide}` +
    lengthInstruction +
    " Bagian CTA di akhir WAJIB mengarahkan audiens menghubungi admin (mis. \"chat admin " +
    "kami\" atau \"hubungi WA admin kami\", boleh divariasikan kalimatnya tapi maksudnya " +
    "harus itu) - JANGAN pakai CTA generik lain (mis. \"pesan sekarang\", \"booking " +
    "sekarang\") tanpa menyebut kontak admin. " +
    "Sertakan juga brollKeywords: 2-4 kata kunci Bahasa INGGRIS singkat utk cari video " +
    "stok (B-roll) pendamping yg relevan dgn suasana/topik ini (mis. \"tropical homestay " +
    "garden\"), atau null kalau topiknya tidak cocok disandingkan stok footage generik. " +
    "Sertakan juga thumbnailText: teks hook SANGAT singkat (2-5 kata, Bahasa Indonesia, " +
    "huruf besar boleh) yg cocok ditempel besar-besar di thumbnail YouTube (mis. " +
    "\"MULAI 175K!\"), atau null kalau tidak ada hook yg pas." +
    buildClassificationFragment(knowledgeSite, customPillarsJson) +
    hookAvoidInstruction +
    contentTypeAvoidInstruction +
    captionStyleAvoidInstruction +
    pillarAvoidInstruction +
    (avoidHashtags.length > 0
      ? `\n\nIMPORTANT: The following hashtags have been used TOO FREQUENTLY recently and MUST be AVOIDED: ${avoidHashtags.join(", ")}. Generate DIFFERENT, fresh hashtags.`
      : "");
  const user = `Brand: ${brandName}\n\nSkrip/brief asli:\n${script}\n\nIsi klip yang terpilih (transkrip):\n${selectedClipsText}${grounding.contextBlock}\n\nBalas HARUS JSON valid (tanpa markdown code fence): {"caption": "...", "hashtags": ["...", "..."], "brollKeywords": "..." atau null, "thumbnailText": "..." atau null, "pillar": "...", "angle": "...", "hookType": "...", "contentType": "ct_*" atau null, "targetKeyword": "..." atau null}`;

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.7,
    max_tokens: isLongForm ? 4000 : undefined,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "{}";
  const cleaned = raw.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
  const parsed = JSON.parse(cleaned);
  return {
    caption: parsed.caption || "",
    hashtags: capHashtags(stripHashPrefix(Array.isArray(parsed.hashtags) ? parsed.hashtags : [])),
    brollKeywords: parsed.brollKeywords || null,
    thumbnailText: parsed.thumbnailText || null,
    structureTemplate: structureTemplate.name,
    pillar: normalizePillar(parsed.pillar),
    angle: normalizeAngle(parsed.angle),
    hookType: normalizeHookType(parsed.hookType),
    captionStyle: normalizeCaptionStyle(parsed.captionStyle),
    contentType: normalizeContentType(parsed.contentType),
    knowledgeUsed: grounding.knowledge,
    ...normalizeTargetKeyword(parsed.targetKeyword),
  };
}

// Konten foto/carousel (type "carousel") TIDAK ada transkrip audio utk dijadikan
// konteks - jadi caption-nya dibuat berdasar foto asli via vision model (bukan cuma
// nebak dari skrip doang), supaya tetap akurat & tidak mengarang klaim yg tdk ada di
// foto (sama prinsipnya dgn video, lihat generateCaptionAndHashtags). Terima BANYAK
// foto sekaligus (carousel 1-5 foto, lihat NewProjectDialog.tsx) - satu caption yg
// merangkum semua foto, bukan per-foto.
export async function generateCaptionForImages(
  brandName: string,
  script: string,
  imageUrls: string[],
  knowledgeSite?: string | null,
  manualKnowledge?: string | null,
  customPillarsJson?: string | null,
  brandId?: string | null
): Promise<GeneratedImageContent> {
  const client = getOpenAIClient();
  // Pillar Target Enforcement (2026-08-19) - sama pola & alasan dgn generateCaptionAndHashtags
  // di atas, lihat catatan lengkap di sana & di contentVariety.ts. Jalur foto/carousel ini
  // SEBELUMNYA tidak punya brandId sama sekali (tidak bisa cek usage), ditambahkan di sini.
  const { counts: pillarUsageCounts, windowSize: pillarWindowSize } = brandId
    ? await getRecentPillarUsage(brandId)
    : { counts: new Map<string, number>(), windowSize: 0 };
  const pillarTargetPercent = pillarTargetPercentForSite(knowledgeSite, customPillarsJson);
  const pillarAvoidInstruction = buildPillarAvoidInstruction(pillarUsageCounts, pillarTargetPercent, pillarWindowSize);
  const grounding = await buildKnowledgeGroundingBlock(knowledgeSite, manualKnowledge);
  // imageUrls KOSONG (2026-08-11) - jalur full AI-generate poster (allowAiGeneratedPhotos,
  // lihat posterDesign.ts) TIDAK PUNYA foto asli sama sekali (visual dibuat SETELAH
  // caption ini, dari script - bukan sebaliknya), jadi instruksi "lihat foto asli" tidak
  // relevan di mode ini - caption dibuat murni dari skrip/brief spt jalur video, TETAP
  // JANGAN mengarang klaim di luar skrip (prinsip sama, sumbernya beda).
  // "Caption lengkap berisi tipsnya" (2026-08-11, permintaan Agus) - SAMA instruksi
  // dgn generateCaptionAndHashtags (video) di atas, diulang di sini krn ini prompt
  // TERPISAH (fungsi beda) - bukan lupa duplikasi, poster/foto TIDAK PUNYA narasi
  // voiceover spt video (yg captionnya otomatis lengkap krn jd naskah TTS), jadi
  // instruksi ini malah LEBIH penting di sini - caption teks SATU-SATUNYA tempat
  // tipsnya ditulis lengkap di luar gambar poster itu sendiri.
  const tipsInstruction =
    " KALAU skrip ini berisi TIPS/CARA/LANGKAH konkret (bukan cuma cerita/promosi biasa), " +
    "caption WAJIB memuat SEMUA poin/langkah tipsnya secara LENGKAP - JANGAN cuma disebut " +
    "sepintas/dijadikan teaser, pembaca harus dapat SELURUH isi tipsnya langsung dari " +
    "caption ini.";
  const photoInstruction =
    (imageUrls.length > 0
      ? "Lihat SEMUA foto yang diberikan (bisa lebih dari satu, urutan sesuai carousel), lalu buat SATU caption yang merangkum & menarik & natural (bukan generik/template) plus MAKSIMAL 5 hashtag PALING relevan (bukan lebih - pilih yg paling tepat sasaran, jangan asal banyak) berdasarkan ISI FOTO ASLI dan skrip/brief. JANGAN mengarang detail yang tidak terlihat di foto."
      : "Tidak ada foto asli utk konten ini (visual dibuat AI generate sesudah caption ini, lihat skrip/brief). Buat SATU caption yang menarik & natural (bukan generik/template) plus MAKSIMAL 5 hashtag PALING relevan (bukan lebih - pilih yg paling tepat sasaran, jangan asal banyak) berdasarkan skrip/brief SAJA. JANGAN mengarang detail yang tidak ada di skrip.") +
    tipsInstruction;
  const system =
    "Kamu content strategist media sosial. " +
    photoInstruction +
    grounding.instruction +
    " Kalau skrip menyebutkan harga/promo/diskon, tulis juga versi SINGKAT teks itu " +
    "(mis. \"Rp175.000\" atau \"Promo 20%\") di field promoText - ini akan ditempel " +
    "sbg badge di foto PERTAMA saja, jadi HARUS singkat (maks ~4 kata). Kalau skrip " +
    "TIDAK menyebut harga/promo sama sekali, promoText HARUS null." +
    buildClassificationFragment(knowledgeSite, customPillarsJson) +
    pillarAvoidInstruction;
  const user = `Brand: ${brandName}\n\nSkrip/brief asli:\n${script}\n\nJumlah foto: ${imageUrls.length}${grounding.contextBlock}\n\nBalas HARUS JSON valid (tanpa markdown code fence): {"caption": "...", "hashtags": ["...", "..."], "promoText": "..." atau null, "pillar": "...", "angle": "...", "hookType": "...", "contentType": "ct_*" atau null, "targetKeyword": "..." atau null}`;

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: user },
          ...imageUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
        ],
      },
    ],
    temperature: 0.7,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "{}";
  const cleaned = raw.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
  const parsed = JSON.parse(cleaned);
  return {
    caption: parsed.caption || "",
    hashtags: capHashtags(stripHashPrefix(Array.isArray(parsed.hashtags) ? parsed.hashtags : [])),
    promoText: parsed.promoText || null,
    pillar: normalizePillar(parsed.pillar),
    angle: normalizeAngle(parsed.angle),
    hookType: normalizeHookType(parsed.hookType),
    captionStyle: normalizeCaptionStyle(parsed.captionStyle),
    contentType: normalizeContentType(parsed.contentType),
    knowledgeUsed: grounding.knowledge,
    ...normalizeTargetKeyword(parsed.targetKeyword),
  };
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

// Bangun subtitle SRT dari klip TERPILIH SAJA, di-retime relatif ke timeline video final
// (mulai dari 0) - bukan timestamp asli di footage mentah, krn video final adalah hasil
// sambungan klip-klip terpilih, bukan footage mentah utuh.
export function buildSrtSubtitles(selectedClips: ScoredSegment[]): string {
  let cursor = 0;
  const blocks = selectedClips.map((clip, i) => {
    const duration = clip.end - clip.start;
    const start = cursor;
    const end = cursor + duration;
    cursor = end;
    return `${i + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${clip.text}\n`;
  });
  return blocks.join("\n");
}

// Subtitle PRESISI dari transkripsi ULANG audio TTS asli (2026-08-06, permintaan Agus -
// "perbaiki subtitle agar presisi dengan dubing sehingga penonton tidak bingung") - lihat
// transcribeAudioBuffer di transcribe.ts utk alasan lengkap. Segment Whisper SUDAH relatif
// ke awal file audio (t=0 saat TTS mulai bicara), TIDAK perlu retiming/akumulasi cursor -
// beda dari buildSrtSubtitles (klip footage ASLI, banyak sumber terpisah, perlu digeser
// relatif ke timeline gabungan). Pecah tiap segment Whisper (bisa 1 kalimat penuh) jadi
// blok lebih pendek (~8 kata) SUPAYA tetap nyaman dibaca di layar - interpolasi LINEAR
// dalam durasi segment aslinya (bukan rata sepanjang TOTAL video spt fungsi lama), jadi
// tetap presisi relatif thd pacing ucapan asli di segment itu, bukan tebakan global.
export function buildSrtFromTranscriptSegments(segments: TranscriptSegment[]): string {
  const wordsPerBlock = 8;
  const blocks: { start: number; end: number; text: string }[] = [];
  for (const seg of segments) {
    const words = seg.text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += wordsPerBlock) {
      chunks.push(words.slice(i, i + wordsPerBlock).join(" "));
    }
    const segDuration = seg.end - seg.start;
    const perChunk = segDuration / chunks.length;
    chunks.forEach((text, i) => {
      blocks.push({ start: seg.start + i * perChunk, end: seg.start + (i + 1) * perChunk, text });
    });
  }
  return blocks
    .map((b, i) => `${i + 1}\n${formatSrtTime(b.start)} --> ${formatSrtTime(b.end)}\n${b.text}\n`)
    .join("\n");
}

// FALLBACK SAJA (2026-08-06, dipertahankan bukan dihapus) - dipakai HANYA kalau
// transcribeAudioBuffer gagal (mis. Whisper API down sesaat) supaya video tetap bisa
// jadi drpd gagal total tanpa subtitle sama sekali - lebih baik subtitle kurang presisi
// drpd tidak ada. Jalur normal SEKARANG pakai buildSrtFromTranscriptSegments di atas.
export function buildCaptionSrt(captionText: string, totalDurationSeconds: number): string {
  const words = captionText.split(/\s+/).filter(Boolean);
  const wordsPerBlock = 8;
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerBlock) {
    chunks.push(words.slice(i, i + wordsPerBlock).join(" "));
  }
  if (chunks.length === 0) return "";

  const perBlock = totalDurationSeconds / chunks.length;
  return chunks
    .map((text, i) => {
      const start = i * perBlock;
      const end = (i + 1) * perBlock;
      return `${i + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${text}\n`;
    })
    .join("\n");
}
