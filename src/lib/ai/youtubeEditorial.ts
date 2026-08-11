import { getOpenAIClient } from "./openaiClient";
import { db } from "@/db";
import { youtubeSeries, projects, channelProfiles } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { newId } from "@/lib/ids";

// BUG NYATA (2026-08-11, laporan Agus - "harusnya 1 di YT tapi ## tertera") - konvensi
// project ini (lihat generateContent.ts stripHashPrefix) SELALU simpan hashtag TANPA
// "#" di DB, "#" baru ditambahkan SEKALI saat publish (orchestrate.ts baseCaption:
// `#${h}`). Fungsi di sini (generateLongFormMetadata/generateShortMetadata) TIDAK
// PERNAH ikut konvensi itu - GPT balikin hashtag SUDAH pakai "#" ("#Shorts" dst), lolos
// disimpan APA ADANYA ke DB, lalu orchestrate.ts nambah "#" LAGI di atasnya jadi
// "##Shorts" pas benar2 di-publish ke YouTube. Fix: strip "#" di SINI (sumbernya),
// bukan ubah orchestrate.ts (itu sudah benar mengikuti konvensi bare-hashtag yg dipakai
// SEMUA jalur lain).
function stripHashPrefix(tags: string[]): string[] {
  return tags.map((t) => t.replace(/^#+/, ""));
}

// YouTube Editorial Engine (2026-08-10, PRD Agus "YouTube Long Form Content Engine" +
// "YouTube Shorts Engine" - "jangan hanya memberi tahu Claude 'buat video YouTube'...
// buat dia memiliki editorial policy dan YouTube growth strategy"). REUSABLE dari awal
// (permintaan eksplisit - "reusable aja siapa tau aku mau buat channel lain") - SEMUA
// fungsi di sini parameterized oleh ChannelProfile (niche/kategori/audiens per channel,
// lihat channelProfiles di schema.ts & ChannelProfileDialog.tsx), TIDAK ADA satu pun
// yang hardcode "Animal Story & Co"/hewan/dst - channel lain tinggal isi Editorial
// Policy-nya sendiri lewat UI, engine yang SAMA jalan utk kategori apa pun.
//
// Model konten TOTAL BEDA dari sistem ide generik (researchTopics.ts, dipakai Pelangi/
// Harmoni/laundry in bali) - itu ide singkat 1-2 kalimat lalu caption/hashtag digenerate
// bareng di generateContent.ts. Video YouTube di sini butuh PAKET LENGKAP (skrip
// dokumenter penuh, 5 varian judul, 3 konsep thumbnail, deskripsi SEO 250-500 kata,
// keyword berlapis, chapter) SEBELUM proses render dimulai - makanya modul terpisah,
// bukan menambal researchTopics.ts yang strukturnya tidak cocok utk paket sebesar ini.
export type ChannelProfile = {
  primaryNiche: string | null;
  contentPillars: string[];
  forbiddenTopics: string[];
  preferredTopics: string[];
  language: string | null;
  targetCountry: string | null;
  targetAudience: string | null;
  youtubeCategoryId: string | null;
};

export type ThumbnailConcept = { subject: string; expression: string; text: string; background: string; trigger: string };
export type SeoKeywords = { primary: string; secondary: string[]; related: string[]; longtail: string[] };
export type Chapter = { time: string; label: string };

export type YoutubeMetadata = {
  titles: string[];
  selectedTitleIndex: number;
  thumbnailConcepts: ThumbnailConcept[];
  seoDescription: string;
  seoKeywords: SeoKeywords;
  hashtags: string[];
  tags: string[];
  chapters: Chapter[]; // kosong sampai distributeChapters() dipanggil (perlu durasi ASLI, lihat catatan di sana)
  // Staging field (2026-08-10) - label bab TANPA timestamp, diisi generateLongFormPackage,
  // DIKONSUMSI processProject.ts (distributeChapters, setelah durasi render asli
  // diketahui) yang mengisi `chapters` di atas & boleh membuang field ini - tidak
  // ditampilkan di mana pun, murni staging antara generate & render.
  chapterLabels?: string[];
  // Judul video long-form asal (2026-08-10) - kalau Short ini hasil repurpose (lihat
  // generateShortsFromLongForm), diisi judul video induknya - MURNI teks utk isi
  // CTA/deskripsi ("tonton video lengkapnya: [judul]"), SENGAJA BUKAN foreign key ke
  // projects.id - project long-form induknya kadang belum ada saat Short ini
  // digenerate (ide harian diproses SATU PER SATU scr berurutan, urutan long-form vs
  // short-nya tidak dijamin, lihat catatan dailyContentPlanner.ts) - link DB yang
  // presisi butuh sistem penautan 2-tahap yang lebih rumit drpd manfaatnya sekarang,
  // teks judul saja sudah cukup memenuhi tujuan PRD (Short menggiring penonton ke video
  // lengkapnya by name).
  parentVideoTitle?: string | null;
  factCheckFlags?: string[]; // self-review klaim yg mungkin butuh diverifikasi ulang manusia, WARNING-ONLY
};

export async function getChannelProfile(socialAccountId: string): Promise<ChannelProfile | null> {
  const [row] = await db.select().from(channelProfiles).where(eq(channelProfiles.socialAccountId, socialAccountId));
  if (!row) return null;
  return {
    primaryNiche: row.primaryNiche,
    contentPillars: row.contentPillars ? JSON.parse(row.contentPillars) : [],
    forbiddenTopics: row.forbiddenTopics ? JSON.parse(row.forbiddenTopics) : [],
    preferredTopics: row.preferredTopics ? JSON.parse(row.preferredTopics) : [],
    language: row.language,
    targetCountry: row.targetCountry,
    targetAudience: row.targetAudience,
    youtubeCategoryId: row.youtubeCategoryId,
  };
}

function stripFence(raw: string): string {
  return raw.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
}

// Rotasi kategori (2026-08-10) - deterministik dari TOTAL seri yang sudah pernah dibuat
// channel ini (lintas format long+short, sengaja SATU rotasi bersama supaya variasi
// kategori channel-wide tetap tinggi, bukan 2 rotasi terpisah yang bisa kebetulan
// nyangkut di kategori yang sama). Kalau contentPillars kosong (channel belum isi
// Editorial Policy sama sekali), fallback "General" - engine tetap jalan, cuma tanpa
// rotasi kategori bermakna.
// `newSeriesCreatedInBatch` (2026-08-10, sama root cause dgn batchClaims di
// pickNextTopic) - kalau >1 seri baru terpaksa dibuat DALAM 1 batch yg sama (dailyVideo
// Count besar & seri lama abis di tengah batch), query `allSeries.length` di bawah
// TIDAK melihat seri yg BARU SAJA dibuat pemanggilan sebelumnya dalam batch yg sama
// (insert-nya sudah commit ke DB, jadi SEBENARNYA query ini akan lihatnya - beda dgn
// pickNextTopic yg nunggu projects yg belum ada - TAPI tetap dijaga eksplisit di sini
// sbg pengaman tambahan, murah & tidak ada downside).
async function pickNextCategory(channelProfile: ChannelProfile, socialAccountId: string): Promise<string> {
  const pillars = channelProfile.contentPillars.length > 0 ? channelProfile.contentPillars : ["General"];
  const allSeries = await db.select({ id: youtubeSeries.id }).from(youtubeSeries).where(eq(youtubeSeries.socialAccountId, socialAccountId));
  return pillars[allSeries.length % pillars.length];
}

// Series & Topic Rotation (2026-08-10, PRD - "Dengan sistem series, AI tidak hanya
// membuat video yang terpisah-pisah, tetapi membangun topical authority... penonton
// yang selesai menonton satu video lebih mungkin melanjutkan ke episode berikutnya").
// Cari seri AKTIF format ini yang masih py topik belum dipakai (dihitung dari COUNT
// projects.youtubeSeriesId = seri itu, BUKAN counter terpisah yang bisa menyimpang dari
// kenyataan) - kalau ada, lanjut episode berikutnya. Kalau tidak ada/semua abis, BIKIN
// seri baru otomatis (kategori dirotasi, topik episode digenerate GPT sekali per seri,
// bukan sekali per video - biaya diamortisasi ~5-8 video).
//
// `batchClaims` (2026-08-10, bug NYATA ditemukan dari batch produksi sungguhan - 6
// video pertama Animal Story & Co SEMUA jadi topik episode 0 yg SAMA ["migratory bird
// navigation"], 4 topik lain di seri yg SAMA ["bioluminescence", "dolphin language",
// "vanishing frogs", "tardigrades"] tidak tersentuh sama sekali). Root cause: dalam 1
// batch (generateYoutubeDailyIdeas memanggil ini berkali-kali BERURUTAN utk N video
// sekaligus), `usedCount` di atas dihitung dari `projects` yg BELUM ADA SAMA SEKALI
// saat batch masih di tahap ide (project baru dibuat belakangan, satu per satu, oleh
// cron/auto-generate) - jadi tiap panggilan dalam batch yg sama SELALU melihat DB yg
// sama persis (0 project baru), balik ke episode 0 terus-menerus. Fix: `batchClaims`
// (Map seriesId->jumlah yg SUDAH DIKLAIM dalam batch INI, di memori, BELUM tersimpan ke
// DB) - ditambahkan ke usedCount dari DB, dan SETIAP topik yg dikembalikan LANGSUNG
// diklaim di Map ini (mutate in-place) SEBELUM function return, supaya panggilan
// BERIKUTNYA dalam batch yg sama tahu topik itu sudah "dipesan". Default Map kosong -
// pemanggilan TUNGGAL (di luar batch, mis. tes manual) tetap berperilaku sama seperti
// sebelumnya.
export async function pickNextTopic(
  channelProfile: ChannelProfile,
  socialAccountId: string,
  format: "long" | "short",
  batchClaims: Map<string, number> = new Map()
): Promise<{ seriesId: string; seriesName: string; topic: string; episodeIndex: number }> {
  const activeSeriesRows = await db
    .select()
    .from(youtubeSeries)
    .where(and(eq(youtubeSeries.socialAccountId, socialAccountId), eq(youtubeSeries.format, format), eq(youtubeSeries.status, "active")))
    .orderBy(desc(youtubeSeries.createdAt));

  for (const series of activeSeriesRows) {
    const topics: string[] = JSON.parse(series.topics);
    const dbUsedCount = (await db.select({ id: projects.id }).from(projects).where(eq(projects.youtubeSeriesId, series.id))).length;
    const claimedInBatch = batchClaims.get(series.id) || 0;
    const usedCount = dbUsedCount + claimedInBatch;
    if (usedCount < topics.length) {
      batchClaims.set(series.id, claimedInBatch + 1);
      return { seriesId: series.id, seriesName: series.name, topic: topics[usedCount], episodeIndex: usedCount };
    }
    if (claimedInBatch === 0) {
      // Cuma tandai "completed" kalau BENAR2 abis di DB (bukan cuma abis krn diklaim
      // batch ini) - series yg baru habis DALAM batch ini masih boleh ditandai completed
      // di iterasi berikutnya setelah project-nya benar2 tersimpan, tidak masalah
      // ditunda - yang WAJIB dihindari adalah menandai completed PADAHAL DB-nya sendiri
      // masih ada slot (akan salah permanen kalau brand ini py 2 seri format sama yg
      // kebetulan diproses berurutan dalam batch yg sama).
      await db.update(youtubeSeries).set({ status: "completed" }).where(eq(youtubeSeries.id, series.id));
    }
  }

  const category = await pickNextCategory(channelProfile, socialAccountId);
  // Anti-duplikat LINTAS SERI (2026-08-11, bug nyata ditemukan dari konten produksi
  // sungguhan - laporan Agus "pembahasan tidak boleh sama") - SEBELUM fix ini,
  // generateSeriesTopics() TIDAK PERNAH tahu topik seri LAIN (aktif MAUPUN selesai,
  // format long MAUPUN short) utk channel yg sama - dicek langsung: 3 seri terpisah
  // (Wild Instincts/Minds of the Wild/Wild Enigmas Unveiled) SEMUA independen
  // menghasilkan topik "dolphin signature whistles/communication", 2 lagi ttg
  // "elephant memory/empathy", 2 lagi ttg "octopus intelligence" - Youtube bisa
  // menganggap ini konten berulang. Fix: kumpulkan SEMUA topik seri manapun (lintas
  // format, lintas status) utk socialAccountId ini, kirim sbg daftar "SUDAH PERNAH
  // DIBAHAS" ke prompt generateSeriesTopics - GPT wajib hindari topik baru yg
  // beririsan (bukan cuma persis sama kata, TAPI sudut/isu yg sama).
  const allExistingSeries = await db
    .select({ topics: youtubeSeries.topics })
    .from(youtubeSeries)
    .where(eq(youtubeSeries.socialAccountId, socialAccountId));
  const existingTopics = allExistingSeries.flatMap((s) => JSON.parse(s.topics) as string[]);
  const { name, topics } = await generateSeriesTopics(channelProfile, category, format, existingTopics);
  const seriesId = newId("ytseries");
  await db.insert(youtubeSeries).values({
    id: seriesId, socialAccountId, name, format, topics: JSON.stringify(topics), status: "active", createdAt: new Date(),
  });
  batchClaims.set(seriesId, 1); // klaim episode 0 SEKARANG - lihat catatan batchClaims di atas
  return { seriesId, seriesName: name, topic: topics[0], episodeIndex: 0 };
}

async function generateSeriesTopics(
  channelProfile: ChannelProfile,
  category: string,
  format: "long" | "short",
  existingTopics: string[] = []
): Promise<{ name: string; topics: string[] }> {
  const client = getOpenAIClient();
  const count = format === "long" ? 5 : 8; // Shorts lebih cepat diproduksi, runway lebih panjang per seri
  const lang = channelProfile.language || "English";
  const forbidden = channelProfile.forbiddenTopics.length
    ? ` NEVER suggest topics related to: ${channelProfile.forbiddenTopics.join(", ")}.`
    : "";
  const preferred = channelProfile.preferredTopics.length
    ? ` Prioritize topics related to: ${channelProfile.preferredTopics.join(", ")} when relevant to this category.`
    : "";
  // Anti-duplikat lintas seri (2026-08-11) - lihat catatan lengkap di pickNextTopic
  // (pemanggil satu2nya fungsi ini) kenapa list ini WAJIB dikirim, bukan optional
  // nice-to-have. Dibatasi 60 topik TERAKHIR (bukan seluruh histori tak terbatas) -
  // cukup utk channel yg sudah py banyak seri tanpa bikin prompt makin lama makin
  // panjang tak terkendali seiring waktu.
  const existingTopicsBlock = existingTopics.length
    ? `\n\nThese topics have ALREADY been covered by this channel (across all past and current series, ` +
      `both long-form and Shorts) - DO NOT repeat any of them, and avoid new topics that cover essentially ` +
      `the same specific angle/fact/subject even if worded differently (e.g. if "dolphin signature whistles" ` +
      `is listed, do NOT also suggest "how dolphins communicate" - that is the same underlying topic to a ` +
      `viewer and risks being flagged as repetitive/duplicate content by YouTube):\n` +
      existingTopics.slice(-60).map((t) => `- ${t}`).join("\n")
    : "";

  const prompt =
    `You are a YouTube content strategist for a channel about "${channelProfile.primaryNiche || "general educational content"}" ` +
    `targeting ${channelProfile.targetAudience || "a general curious audience"}.\n\n` +
    `Create ONE themed video series in the category "${category}" for ${format === "long" ? "long-form documentary videos (5-8 min each)" : "YouTube Shorts (20-60 sec each)"}. ` +
    `Give the series a short catchy name, and list EXACTLY ${count} specific episode topics - each a distinct, evergreen, curiosity-driven angle within this category (not generic, not duplicates of each other, avoid temporary trends/celebrity/seasonal topics unless the category itself is inherently seasonal). ` +
    `All output MUST be in ${lang}.${forbidden}${preferred}${existingTopicsBlock}\n\n` +
    `Reply as valid JSON only (no markdown fence): {"name": "...", "topics": ["...", ...]}`;

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.9,
  });
  const parsed = JSON.parse(stripFence(completion.choices[0]?.message?.content?.trim() || "{}"));
  return {
    name: typeof parsed.name === "string" && parsed.name ? parsed.name : category,
    topics: Array.isArray(parsed.topics) && parsed.topics.length > 0 ? parsed.topics.slice(0, count) : [category],
  };
}

// ---------------------------------------------------------------------------
// LONG-FORM (5-8 menit)
// ---------------------------------------------------------------------------

const LONG_FORM_WORDS_PER_SECOND = 2.5; // sama estimasi dgn generateContent.ts WORDS_PER_SECOND
const LONG_FORM_TARGET_SECONDS = 390; // ~6.5 menit, tengah target PRD 5-8 menit

// Struktur naskah (2026-08-10) - PERSIS beats dari PRD Agus (Hook/Viewer Promise/Story
// Introduction/Main Documentary/Pattern Interrupts/Ending) - BEDA TOTAL dari
// LONG_FORM_STRUCTURE_TEMPLATES di generateContent.ts (itu spesifik hospitality/
// Pelangi: "Perkenalan-Fasilitas-Kamar-Sekitar", tidak relevan sama sekali utk konten
// dokumenter/edukasi) - modul terpisah krn domain kontennya beda total, bukan duplikasi
// tanpa alasan.
export async function generateLongFormScript(
  channelProfile: ChannelProfile,
  topic: string,
  recentScripts: string[]
): Promise<string> {
  const client = getOpenAIClient();
  const lang = channelProfile.language || "English";
  const targetWords = Math.round(LONG_FORM_TARGET_SECONDS * LONG_FORM_WORDS_PER_SECOND);

  const system =
    `You are a professional documentary narrator/scriptwriter for a YouTube channel about "${channelProfile.primaryNiche || "educational content"}", ` +
    `targeting ${channelProfile.targetAudience || "curious general viewers"}${channelProfile.targetCountry ? ` in ${channelProfile.targetCountry}` : ""}. ` +
    "Your primary goal is WATCH TIME and audience retention, not short-term viral shock value - think like a documentary content creator, not an AI video generator.\n\n" +
    "STRUCTURE (follow this exactly, but do NOT label the sections literally in the output - flow naturally through them as one continuous narration):\n" +
    "1) HOOK (first ~15 sec): open with a strong curiosity-driven statement. NEVER begin with 'Hello everyone' or 'Welcome back' - create immediate curiosity instead.\n" +
    "2) VIEWER PROMISE: tell viewers what they will discover in this video.\n" +
    "3) STORY INTRODUCTION: introduce the topic naturally.\n" +
    "4) MAIN DOCUMENTARY: explain what, why, how, interesting facts, scientific explanation, real examples - in real depth.\n" +
    "5) PATTERN INTERRUPTS: roughly every 30-45 seconds of narration, introduce something new (a new fact, a surprising discovery, a comparison, a curiosity question) so the viewer never gets bored - vary sentence rhythm and paragraph length accordingly.\n" +
    "6) ENDING: summarize naturally, then a SOFT call-to-action encouraging viewers to watch another related video (not a hard sell).\n\n" +
    "RULES: be 100% original, tell a STORY (not a Wikipedia-style fact list or simple enumeration), maintain scientific accuracy - if unsure of a precise number/statistic, describe it qualitatively instead of inventing a specific figure, avoid repetitive wording and generic AI-sounding phrases, avoid a robotic tone - sound like a real documentary narrator. " +
    `Target length: approximately ${targetWords} words (this becomes a voiceover script - it must genuinely take 5-8 minutes to narrate aloud, do not undershoot). ` +
    `Write entirely in ${lang}.` +
    (channelProfile.forbiddenTopics.length ? ` NEVER mention or relate this to: ${channelProfile.forbiddenTopics.join(", ")}.` : "");

  const user =
    `Topic for this episode: "${topic}"\n\n` +
    `Scripts already used recently on this channel (DO NOT repeat the same angle, facts, or wording):\n` +
    `${recentScripts.length ? recentScripts.map((s) => `- ${s.slice(0, 150)}...`).join("\n") : "(none yet)"}\n\n` +
    "Write the full narration script now, as continuous prose (no section headers, no timestamps) ready to be read aloud by a voiceover artist.";

  // gpt-4.1-mini (2026-08-10, permintaan Agus - biaya gpt-4.1 tinggi di 3 titik penulis
  // naskah ini). BUKAN gpt-5-mini - dicek dulu histori 2 project lain di akun ini: AI
  // Blog SUDAH coba gpt-5-mini lalu di-revert krn model reasoning ini py token
  // "thinking" tersembunyi, output-nya malah 25% LEBIH MAHAL drpd gpt-4.1-mini ($2.00
  // vs $1.60/1M) + sempat jadi model termahal di stack; AI Chat Bot jg revert (latency).
  // Naskah di sini OUTPUT-HEAVY (ratusan kata narasi) - skema harga gpt-5-mini yg
  // outputnya lebih mahal justru beresiko biaya NAIK bukan turun utk tipe panggilan ini.
  // gpt-4.1-mini sudah terbukti reliable di KontenPilot ini sendiri (150x panggilan
  // lain) & tetap potong biaya ~80% ($2.00/$8.00 -> $0.40/$1.60 per 1M token).
  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.85,
    max_tokens: 3000,
  });
  return completion.choices[0]?.message?.content?.trim() || "";
}

// Paket metadata upload (2026-08-10) - SATU panggilan GPT gabungan (judul+thumbnail+SEO+
// hashtag+tag sekaligus, chapterLabels TANPA timestamp - lihat distributeChapters) -
// pola SAMA dgn generateCaptionAndHashtags di generateContent.ts (1 panggilan utk
// banyak field terkait, bukan dipisah2 biar hemat biaya/waktu).
export async function generateLongFormMetadata(
  channelProfile: ChannelProfile,
  topic: string,
  script: string
): Promise<Omit<YoutubeMetadata, "chapters" | "parentVideoTitle" | "factCheckFlags"> & { chapterLabels: string[] }> {
  const client = getOpenAIClient();
  const lang = channelProfile.language || "English";

  const system =
    "You are a YouTube SEO and growth strategist. Given a documentary video's topic and full narration script, generate a COMPLETE upload metadata package optimized for CTR, watch time, and search discovery.\n\n" +
    "Reply as valid JSON only (no markdown fence), matching this EXACT shape:\n" +
    "{\n" +
    '  "titles": ["...", "...", "...", "...", "..."],\n' +
    '  "selectedTitleIndex": 0,\n' +
    '  "thumbnailConcepts": [{"subject": "...", "expression": "...", "text": "...", "background": "...", "trigger": "..."}],\n' +
    '  "seoDescription": "...",\n' +
    '  "seoKeywords": {"primary": "...", "secondary": ["...", "..."], "related": ["...", "..."], "longtail": ["...", "..."]},\n' +
    '  "hashtags": ["...", "..."],\n' +
    '  "tags": ["...", "..."],\n' +
    '  "chapterLabels": ["Introduction", "...", "..."]\n' +
    "}\n\n" +
    "Field requirements:\n" +
    "- titles: EXACTLY 5 variations covering these angles in order: curiosity, educational, documentary-style, SEO-focused, high-CTR.\n" +
    "- selectedTitleIndex: index (0-4) of the single best title to actually use for upload.\n" +
    "- thumbnailConcepts: EXACTLY 3 concepts, each `text` field MAXIMUM 4 words.\n" +
    "- seoDescription: 250-500 words, natural summary of the video, includes the primary keyword and secondary keywords naturally, encourages subscribing, recommends watching related videos, NO keyword stuffing.\n" +
    "- hashtags: EXACTLY 3-5, only highly relevant ones.\n" +
    "- tags: 15-25 searchable evergreen YouTube tags (lowercase, no # symbol).\n" +
    "- chapterLabels: 4-7 short chapter labels IN NARRATIVE ORDER matching the script's actual flow (first one always something like \"Introduction\") - these are LABELS ONLY, timestamps are computed separately from the real rendered audio, do not include any time value.\n\n" +
    `Everything MUST be written in ${lang}.`;

  const user = `Video topic: "${topic}"\n\nFull narration script:\n${script}`;

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.7,
  });
  const parsed = JSON.parse(stripFence(completion.choices[0]?.message?.content?.trim() || "{}"));

  return {
    titles: Array.isArray(parsed.titles) && parsed.titles.length > 0 ? parsed.titles.slice(0, 5) : [topic],
    selectedTitleIndex:
      typeof parsed.selectedTitleIndex === "number" && parsed.selectedTitleIndex >= 0 && parsed.selectedTitleIndex < 5
        ? parsed.selectedTitleIndex
        : 0,
    thumbnailConcepts: Array.isArray(parsed.thumbnailConcepts) ? parsed.thumbnailConcepts.slice(0, 3) : [],
    seoDescription: typeof parsed.seoDescription === "string" ? parsed.seoDescription : "",
    seoKeywords:
      parsed.seoKeywords && typeof parsed.seoKeywords === "object"
        ? {
            primary: parsed.seoKeywords.primary || topic,
            secondary: Array.isArray(parsed.seoKeywords.secondary) ? parsed.seoKeywords.secondary : [],
            related: Array.isArray(parsed.seoKeywords.related) ? parsed.seoKeywords.related : [],
            longtail: Array.isArray(parsed.seoKeywords.longtail) ? parsed.seoKeywords.longtail : [],
          }
        : { primary: topic, secondary: [], related: [], longtail: [] },
    hashtags: Array.isArray(parsed.hashtags) ? stripHashPrefix(parsed.hashtags.slice(0, 5)) : [],
    tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 25) : [],
    chapterLabels: Array.isArray(parsed.chapterLabels) && parsed.chapterLabels.length >= 3 ? parsed.chapterLabels : ["Introduction"],
  };
}

// Chapter timestamps (2026-08-10) - distribusi PROPORSIONAL sepanjang durasi ASLI hasil
// render (dipanggil dari processProject.ts SETELAH renderFinalVideo, baru tahu durasi
// sungguhan - lihat pola yang sama dgn "Subtitle PRESISI" 2026-08-06: jangan estimasi
// sebelum render kalau bisa pakai angka nyata sesudahnya). Bukan pengukuran section
// SUNGGUHAN dari isi skrip (butuh alignment teks-ke-audio yang jauh lebih rumit) -
// heuristik rata level yang SAMA dgn grouping kata Subtitle Designer, cukup akurat utk
// penanda bab YouTube (tidak perlu presisi frame). Aturan keras YouTube: bab pertama
// WAJIB mulai 0:00, minimal 3 bab, tiap bab minimal 10 detik - dipaksakan di sini.
export function distributeChapters(labels: string[], totalDurationSeconds: number): Chapter[] {
  const MIN_CHAPTER_SECONDS = 10;
  const maxChapters = Math.max(3, Math.min(labels.length, Math.floor(totalDurationSeconds / MIN_CHAPTER_SECONDS)));
  const usableLabels = labels.slice(0, Math.max(3, maxChapters));
  const step = totalDurationSeconds / usableLabels.length;

  return usableLabels.map((label, i) => ({
    time: secondsToChapterTime(Math.round(i * step)),
    label,
  }));
}

function secondsToChapterTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

// Self-review fakta (2026-08-10) - WARNING-ONLY (sama disiplin dgn factCheck.ts yg
// SUDAH ada, lihat catatan projects.factCheckConfidence di schema.ts) - BEDA sumber
// groundingnya: factCheck.ts cross-check ke Knowledge Base BRAND (Pelangi/Harmoni),
// konten dokumenter animal facts TIDAK PUNYA knowledge base internal spt itu (faktanya
// pengetahuan umum, bukan data properti). Jadi ini self-critique GPT (model diminta
// mereview HASILNYA SENDIRI cari klaim yang terlalu spesifik/beresiko salah - angka
// pasti, statistik presisi, klaim absolut "satu-satunya di dunia") - TIDAK memblokir
// apa pun, cuma dicatat spy Agus bisa cek manual sebelum benar2 percaya videonya, sama
// alasan "belum ada data nyata utk kalibrasi threshold block" yang sudah didokumentasi
// di projects.similarityScore.
export async function reviewScriptFactualRisk(script: string): Promise<string[]> {
  const client = getOpenAIClient();
  const prompt =
    "Review the following documentary narration script for factual risk. List (as a JSON array of short strings) " +
    "any specific claims that are precise/absolute enough to need independent verification before publishing " +
    "(exact statistics, superlatives like 'the only animal that...', specific numbers) - each item should quote " +
    "the risky claim briefly. Reply with an EMPTY array if the script only contains safe, well-established, " +
    "qualitative facts. Reply as valid JSON only (no markdown fence): {\"flags\": [\"...\"]}\n\n" +
    `Script:\n${script}`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    });
    const parsed = JSON.parse(stripFence(completion.choices[0]?.message?.content?.trim() || "{}"));
    return Array.isArray(parsed.flags) ? parsed.flags : [];
  } catch (err) {
    console.error("[youtubeEditorial] gagal self-review fakta, dilewati (warning-only):", err);
    return [];
  }
}

// Orkestrator long-form (2026-08-10) - dipanggil dailyContentPlanner.ts. Return `idea`
// (skrip lengkap - dipakai APA ADANYA sbg naskah voiceover oleh pipeline render yang
// SUDAH ADA, sama seperti caption Pelangi jadi naskah TTS-nya sendiri) + youtubeMetadata
// (chapters MASIH KOSONG, diisi processProject.ts setelah durasi asli diketahui).
export async function generateLongFormPackage(
  channelProfile: ChannelProfile,
  socialAccountId: string,
  recentScripts: string[],
  batchClaims: Map<string, number> = new Map()
): Promise<{ script: string; youtubeSeriesId: string; youtubeMetadata: YoutubeMetadata }> {
  const { seriesId, topic } = await pickNextTopic(channelProfile, socialAccountId, "long", batchClaims);
  const script = await generateLongFormScript(channelProfile, topic, recentScripts);
  const metadata = await generateLongFormMetadata(channelProfile, topic, script);
  const factCheckFlags = await reviewScriptFactualRisk(script);

  return {
    script,
    youtubeSeriesId: seriesId,
    youtubeMetadata: {
      titles: metadata.titles,
      selectedTitleIndex: metadata.selectedTitleIndex,
      thumbnailConcepts: metadata.thumbnailConcepts,
      seoDescription: metadata.seoDescription,
      seoKeywords: metadata.seoKeywords,
      hashtags: metadata.hashtags,
      tags: metadata.tags,
      chapters: [], // diisi distributeChapters() di processProject.ts, konsumsi chapterLabels di bawah
      chapterLabels: metadata.chapterLabels,
      factCheckFlags,
    },
  };
}

// ---------------------------------------------------------------------------
// SHORTS (20-60 detik)
// ---------------------------------------------------------------------------
//
// Strategi TOTAL BEDA dari long-form (PRD Agus - "jangan membuat Shorts seperti versi
// pendek dari long-form"): long-form kejar watch time/retention, Shorts kejar
// DISCOVERY/subscriber/viral reach lewat Shorts Feed - hook HARUS dalam 1-2 detik
// pertama, SATU ide per Short (bukan daftar beberapa fakta), CTA lembut ke channel
// (bukan ke 1 video spesifik) KECUALI ini hasil repurpose dari long-form (lihat
// generateShortsFromLongForm di bawah - CTA-nya spesifik "tonton video lengkapnya").

const SHORTS_WORDS_PER_SECOND = 2.8; // sedikit lebih cepat dari long-form - gaya Shorts lebih energetic/padat

export async function generateShortScript(
  channelProfile: ChannelProfile,
  topic: string,
  recentScripts: string[],
  targetSeconds: number = 40
): Promise<string> {
  const client = getOpenAIClient();
  const lang = channelProfile.language || "English";
  const targetWords = Math.round(targetSeconds * SHORTS_WORDS_PER_SECOND);

  const system =
    `You are a YouTube Shorts scriptwriter for a channel about "${channelProfile.primaryNiche || "educational content"}", ` +
    `targeting ${channelProfile.targetAudience || "a general curious audience"}. Your goal is DISCOVERY and completion rate ` +
    "(85-100% watch-through), NOT a shortened version of a long-form video - one Short = ONE idea, never a list of unrelated facts.\n\n" +
    "The first 1-2 SECONDS are everything. NEVER begin with a greeting ('Hello everyone', 'Today we are talking about...'). " +
    "Open with something that makes it IMPOSSIBLE to scroll past - a surprising statement, a bold claim, an unexpected fact stated directly.\n\n" +
    "STRUCTURE (do not label sections, flow as one continuous energetic narration): " +
    "Hook (first 1-2 sec) -> Quick Explanation -> Amazing/Surprising Fact -> Final Surprise/Payoff -> soft CTA.\n\n" +
    "Answer implicitly: What? Why? What's the interesting fact? What's the final surprise? " +
    `Target length: approximately ${targetWords} words (${targetSeconds} seconds of narration - fast-paced, energetic, natural, never robotic). ` +
    `Write entirely in ${lang}.` +
    (channelProfile.forbiddenTopics.length ? ` NEVER mention or relate this to: ${channelProfile.forbiddenTopics.join(", ")}.` : "");

  const user =
    `Topic for this Short: "${topic}"\n\n` +
    `Scripts already used recently on this channel (DO NOT repeat the same hook/fact/wording):\n` +
    `${recentScripts.length ? recentScripts.map((s) => `- ${s.slice(0, 120)}...`).join("\n") : "(none yet)"}\n\n` +
    "Write the full narration script now, as continuous prose ready to be read aloud.";

  // gpt-4.1-mini (2026-08-10, penghematan biaya - lihat catatan lengkap di
  // generateLongFormScript di atas kenapa BUKAN gpt-5-mini).
  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.9,
    max_tokens: 500,
  });
  return completion.choices[0]?.message?.content?.trim() || "";
}

export async function generateShortMetadata(
  channelProfile: ChannelProfile,
  topic: string,
  script: string
): Promise<Pick<YoutubeMetadata, "titles" | "selectedTitleIndex" | "seoDescription" | "hashtags" | "tags"> & { thumbnailConcept: ThumbnailConcept | null }> {
  const client = getOpenAIClient();
  const lang = channelProfile.language || "English";

  const system =
    "You are a YouTube Shorts growth strategist. Given a Short's topic and script, generate upload metadata optimized " +
    "for the Shorts Feed algorithm (CTR + completion rate), reply as valid JSON only (no markdown fence):\n" +
    "{\n" +
    '  "titles": ["...", "...", "...", "...", "..."],\n' +
    '  "selectedTitleIndex": 0,\n' +
    '  "seoDescription": "...",\n' +
    '  "hashtags": ["#Shorts", "...", "..."],\n' +
    '  "tags": ["...", "..."],\n' +
    '  "thumbnailConcept": {"subject": "...", "expression": "...", "text": "...", "background": "...", "trigger": "..."}\n' +
    "}\n\n" +
    "titles: EXACTLY 5 short punchy variations. seoDescription: 100-200 words (summary + related keywords + soft CTA). " +
    'hashtags: 3-5, ALWAYS include "#Shorts" as one of them. tags: 10-20 searchable evergreen tags. ' +
    "thumbnailConcept: text field maximum 4 words. " +
    `Everything MUST be written in ${lang}.`;

  const user = `Short topic: "${topic}"\n\nScript:\n${script}`;

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.7,
  });
  const parsed = JSON.parse(stripFence(completion.choices[0]?.message?.content?.trim() || "{}"));

  return {
    titles: Array.isArray(parsed.titles) && parsed.titles.length > 0 ? parsed.titles.slice(0, 5) : [topic],
    selectedTitleIndex:
      typeof parsed.selectedTitleIndex === "number" && parsed.selectedTitleIndex >= 0 && parsed.selectedTitleIndex < 5
        ? parsed.selectedTitleIndex
        : 0,
    seoDescription: typeof parsed.seoDescription === "string" ? parsed.seoDescription : "",
    hashtags: Array.isArray(parsed.hashtags) && parsed.hashtags.length > 0 ? stripHashPrefix(parsed.hashtags.slice(0, 5)) : ["Shorts"],
    tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 20) : [],
    thumbnailConcept: parsed.thumbnailConcept && typeof parsed.thumbnailConcept === "object" ? parsed.thumbnailConcept : null,
  };
}

// Orkestrator Shorts standalone (2026-08-10) - topik dari rotasi seri Shorts sendiri
// (format "short", terpisah dari rotasi long-form - lihat pickNextTopic).
export async function generateShortPackage(
  channelProfile: ChannelProfile,
  socialAccountId: string,
  recentScripts: string[],
  batchClaims: Map<string, number> = new Map()
): Promise<{ script: string; youtubeSeriesId: string; youtubeMetadata: YoutubeMetadata }> {
  const { seriesId, topic } = await pickNextTopic(channelProfile, socialAccountId, "short", batchClaims);
  const script = await generateShortScript(channelProfile, topic, recentScripts);
  const metadata = await generateShortMetadata(channelProfile, topic, script);

  return {
    script,
    youtubeSeriesId: seriesId,
    youtubeMetadata: {
      titles: metadata.titles,
      selectedTitleIndex: metadata.selectedTitleIndex,
      thumbnailConcepts: metadata.thumbnailConcept ? [metadata.thumbnailConcept] : [],
      seoDescription: metadata.seoDescription,
      seoKeywords: { primary: topic, secondary: [], related: [], longtail: [] },
      hashtags: metadata.hashtags,
      tags: metadata.tags,
      chapters: [], // Shorts tidak pakai chapter (durasi terlalu pendek utk relevan)
    },
  };
}

// Repurposing (2026-08-10, PRD - "Whenever possible: One Long-form Video -> Generate
// 3-5 Shorts... creates a content ecosystem where Shorts continuously funnel viewers
// into the long-form library"). BEDA dari generateShortPackage standalone di atas:
// topik TIDAK dari rotasi seri Shorts sendiri, tapi diekstrak LANGSUNG dari skrip
// long-form yang baru selesai dibuat - tiap Short fokus ke SATU hook/fakta spesifik
// dari video itu, & CTA-nya eksplisit "tonton video lengkapnya" (bukan CTA generik ke
// channel) krn tujuannya memang menggiring balik ke video long-form itu, bukan berdiri
// sendiri. TIDAK menyentuh youtubeSeries sama sekali (bukan bagian dari seri mana pun -
// parentVideoTitle di youtubeMetadata yang jadi penanda hubungannya, bukan seriesId -
// lihat catatan di type YoutubeMetadata kenapa ini teks judul, bukan FK project.id).
export async function generateShortsFromLongForm(
  channelProfile: ChannelProfile,
  longFormTopic: string,
  longFormScript: string,
  longFormTitle: string,
  count: number = 3
): Promise<Array<{ script: string; youtubeMetadata: YoutubeMetadata }>> {
  const client = getOpenAIClient();
  const lang = channelProfile.language || "English";

  // Ekstrak N hook/fakta spesifik dari skrip long-form yang SUDAH ADA (1 panggilan GPT,
  // bukan re-brainstorm topik baru dari nol) - tiap hook jadi topik 1 Short.
  const hooksPrompt =
    `From the following documentary script (title: "${longFormTitle}"), extract EXACTLY ${count} distinct, ` +
    "self-contained, curiosity-driven facts/moments that would each work as a standalone YouTube Short hook " +
    "(each one must make sense on its own without the full context of the video). " +
    `Reply as valid JSON only (no markdown fence): {"hooks": ["...", ...]}\n\nScript:\n${longFormScript}`;
  const hooksCompletion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [{ role: "user", content: hooksPrompt }],
    temperature: 0.7,
  });
  const hooksParsed = JSON.parse(stripFence(hooksCompletion.choices[0]?.message?.content?.trim() || "{}"));
  const hooks: string[] = Array.isArray(hooksParsed.hooks) && hooksParsed.hooks.length > 0 ? hooksParsed.hooks.slice(0, count) : [longFormTopic];

  const results: Array<{ script: string; youtubeMetadata: YoutubeMetadata }> = [];
  for (const hook of hooks) {
    const system =
      `You are a YouTube Shorts scriptwriter repurposing a moment from a long-form video ("${longFormTitle}") into a ` +
      "standalone Short. Same rules as any Short: hook in the first 1-2 seconds, ONE idea, energetic and natural, never robotic. " +
      "End with a CTA that specifically invites viewers to watch the FULL video on the channel for more (not a generic subscribe CTA). " +
      `Target ~35 seconds (${Math.round(35 * SHORTS_WORDS_PER_SECOND)} words). Write entirely in ${lang}.`;
    const user = `Specific moment/fact to build this Short around:\n"${hook}"`;
    // gpt-4.1-mini (2026-08-10, penghematan biaya - lihat catatan lengkap di
    // generateLongFormScript kenapa BUKAN gpt-5-mini).
    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.9,
      max_tokens: 400,
    });
    const script = completion.choices[0]?.message?.content?.trim() || "";
    if (!script) continue;

    const metadata = await generateShortMetadata(channelProfile, hook, script);
    results.push({
      script,
      youtubeMetadata: {
        titles: metadata.titles,
        selectedTitleIndex: metadata.selectedTitleIndex,
        thumbnailConcepts: metadata.thumbnailConcept ? [metadata.thumbnailConcept] : [],
        seoDescription: metadata.seoDescription,
        seoKeywords: { primary: hook, secondary: [], related: [], longtail: [] },
        hashtags: metadata.hashtags,
        tags: metadata.tags,
        chapters: [],
        parentVideoTitle: longFormTitle,
      },
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// ORKESTRATOR HARIAN (dipanggil dailyContentPlanner.ts)
// ---------------------------------------------------------------------------
//
// Long-form dibuat DULUAN, baru Shorts - Shorts MENGISI SLOT dgn REPURPOSE dari
// long-form hari ini LEBIH DULU (PRD - "content ecosystem", lihat generateShortsFromLongForm),
// slot sisa (kalau shortCount > 3x longCount, atau longCount=0) diisi Shorts standalone
// dari rotasi seri Shorts sendiri (generateShortPackage). `idea` di tiap hasil = SKRIP
// PENUH (dipakai APA ADANYA sbg naskah oleh pipeline render yg sudah ada, sama pola dgn
// caption Pelangi jadi naskah TTS-nya sendiri - lihat generateContent.ts).
export type YoutubeDailyIdea = {
  idea: string;
  contentType: "video";
  contentFormat: "youtube_shorts" | null;
  youtubeSeriesId: string | null;
  youtubeMetadata: YoutubeMetadata;
};

export async function generateYoutubeDailyIdeas(
  channelProfile: ChannelProfile,
  socialAccountId: string,
  longCount: number,
  shortCount: number,
  recentScripts: string[]
): Promise<YoutubeDailyIdea[]> {
  const results: YoutubeDailyIdea[] = [];
  const usedScripts = [...recentScripts];
  // batchClaims (2026-08-10, bug nyata - lihat catatan lengkap di pickNextTopic) - SATU
  // Map dibagi bersama SELURUH batch ini (long-form maupun Shorts standalone) supaya
  // tiap panggilan pickNextTopic tahu topik yg SUDAH "dipesan" pemanggilan sebelumnya
  // dalam batch yg sama, sebelum project-nya benar2 tersimpan ke DB.
  const batchClaims = new Map<string, number>();

  const longPackages: Array<{ script: string; title: string }> = [];
  for (let i = 0; i < longCount; i++) {
    const pkg = await generateLongFormPackage(channelProfile, socialAccountId, usedScripts, batchClaims);
    usedScripts.push(pkg.script);
    const title = pkg.youtubeMetadata.titles[pkg.youtubeMetadata.selectedTitleIndex] || pkg.youtubeMetadata.titles[0] || "";
    longPackages.push({ script: pkg.script, title });
    results.push({
      idea: pkg.script,
      contentType: "video",
      contentFormat: null,
      youtubeSeriesId: pkg.youtubeSeriesId,
      youtubeMetadata: pkg.youtubeMetadata,
    });
  }

  let shortsRemaining = shortCount;
  for (const longPkg of longPackages) {
    if (shortsRemaining <= 0) break;
    const n = Math.min(shortsRemaining, 3);
    const repurposed = await generateShortsFromLongForm(channelProfile, longPkg.title, longPkg.script, longPkg.title, n);
    for (const r of repurposed) {
      usedScripts.push(r.script);
      results.push({
        idea: r.script,
        contentType: "video",
        contentFormat: "youtube_shorts",
        youtubeSeriesId: null,
        youtubeMetadata: r.youtubeMetadata,
      });
      shortsRemaining--;
    }
  }
  while (shortsRemaining > 0) {
    const pkg = await generateShortPackage(channelProfile, socialAccountId, usedScripts, batchClaims);
    usedScripts.push(pkg.script);
    results.push({
      idea: pkg.script,
      contentType: "video",
      contentFormat: "youtube_shorts",
      youtubeSeriesId: pkg.youtubeSeriesId,
      youtubeMetadata: pkg.youtubeMetadata,
    });
    shortsRemaining--;
  }

  return results;
}
