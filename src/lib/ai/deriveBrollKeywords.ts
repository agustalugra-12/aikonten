import { getOpenAIClient } from "./openaiClient";

// Terjemahkan ide/skrip jadi kata kunci Bahasa Inggris utk cari video stok Pexels/
// Pixabay (2026-08-04, permintaan Agus - fallback "tidak ada footage asli utk ide
// UMUM" di auto-content/route.ts). BEDA dari brollKeywords di generateContent.ts (yg
// jalan SETELAH ada transkrip footage asli, sbg B-roll PENDAMPING) - fungsi ini dipanggil
// SEBELUM ada footage apa pun sama sekali, keyword digali langsung dari ide/skrip mentah.
//
// Prompt & fallback digeneralisasi (2026-08-10, bug nyata - versi lama asumsi input
// SELALU Bahasa Indonesia & fallback default HARDCODE "travel lifestyle", ikut jadi
// salah satu sumber bias hospitality yg bocor ke SEMUA brand termasuk yg bukan travel/
// penginapan - reused fungsi ini dipakai brand APA PUN, termasuk skrip dokumenter
// Bahasa Inggris YouTube Editorial Engine) - sekarang terima skrip BAHASA APA PUN,
// fallback netral "nature scenery" (B-roll ambient generik, tidak menganggap kontennya
// soal travel/penginapan). Panjang query DIBATASI di broll.ts (titik pusat, melindungi
// SEMUA sumber query B-roll sekaligus) - bukan di sini.
// Prompt diperjelas (2026-08-10, laporan Agus - "gunakan salah satu footage yang ada
// fokus ke hewan agar ada permainan kamera tidak monoton") - versi lama minta "keyword
// singkat sesuai mood/subjek" TANPA penekanan eksplisit ke SUBJEK KONKRET-nya (bisa
// jatuh ke keyword suasana abstrak spt "misty forest" walau skripnya jelas2 bahas hewan
// SPESIFIK) atau ke gerakan kamera (klip statis pemandangan terasa monoton dibanding
// klip dinamis subjeknya sendiri bergerak). SEKARANG diminta eksplisit utamakan SUBJEK
// KONKRET yg disebut skrip (nama hewan/benda/tempat spesifik, BUKAN cuma "nature"/
// "lifestyle" generik) + kata gerak (flying/swimming/running/close-up/slow motion) yg
// bikin klip lebih dinamis - TETAP generik lintas brand (bukan HARDCODE "animal", brand
// laundry/lain tetap dapat instruksi yg sama masuk akal utk subjek MEREKA sendiri).
//
// ARRAY, bukan 1 string (2026-09-07, laporan Agus - "footage jangan monoton", audit
// "AI Konten Fase 7-10" §addendum Context-Aware Footage) - SEBELUM ini 1 keyword dipakai
// BERULANG-ULANG di tiap iterasi loop top-up durasi (processProject.ts) begitu footage
// asli habis/video butuh banyak klip B-roll (long-form/footage bank kecil), jadi SEMUA
// klip padding di 1 video bertema visual persis sama. Sengaja TIDAK direstrukturisasi
// jadi "per-scene dgn timestamp presis" (dicoba, ternyata brollClips SELALU ditumpuk di
// AKHIR urutan klip di processProject.ts - alignment presisi ke scene butuh rombak alur
// render, risiko tinggi ke sistem yg sudah stabil, Agus eksplisit minta jangan). Ini
// versi AMAN: 1 panggilan AI YANG SAMA (nol biaya tambahan), cuma minta beberapa VARIAN
// sudut/aspek berbeda dari topik yg sama, dipakai BERGANTIAN (pickBrollKeyword di bawah)
// tiap loop top-up butuh klip baru - variasi visual dlm pool padding, tanpa menyentuh
// urutan/waktu klip di timeline sama sekali.
export async function deriveBrollKeywordsFromScript(script: string, broaden: boolean = false): Promise<string[]> {
  const client = getOpenAIClient();
  // `broaden` (2026-08-12, Fase 2b PRD Animal Story & Co - auto-fix ladder utk reject
  // point "footage tidak cukup") - dipanggil KEDUA KALINYA kalau top-up dgn keyword
  // SEMPIT (subjek konkret spesifik, mis. nama spesies jarang) gagal capai durasi
  // minimum krn Pexels/Pixabay genuinely kehabisan hasil utk query itu (bukan soal
  // anti-monoton - searchPexelsVideo SUDAH toleran thd pengulangan sendiri, lihat
  // catatan di pexels.ts). Minta keyword yg LEBIH LUAS/generik (kategori/scene-type,
  // BUKAN nama spesies spesifik) drpd gagal total - degradasi yg PRD sendiri anggap
  // wajar (section 25: "cheaper/fewer regenerations... drpd hard stop"), bukan reject.
  const broadenInstruction = broaden
    ? " IMPORTANT: a NARROW/specific search for this subject already returned too few results from stock footage " +
      "libraries - this time, generalize to a BROADER category/scene-type instead of the exact species/subject name " +
      "(e.g. instead of a rare species name, use its general animal family/habitat/behavior type - 'deep sea creature', " +
      "'nocturnal predator', 'rainforest wildlife'), so stock search has more results to choose from. "
    : "";
  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content:
          "Convert this content idea/script (any language) into 2-3 SEPARATE sets of short English keywords to " +
          "search for stock video footage - each set representing a DIFFERENT angle/aspect of the SAME topic " +
          "(not synonyms of the same thing), so a video needing many B-roll clips doesn't end up visually " +
          "repetitive. PRIORITIZE the SPECIFIC concrete subject the script is actually about (a named animal, " +
          "object, place, or activity) over vague mood/scenery words - e.g. for a script about how owls hunt at " +
          "night, prefer sets like 'owl flying night hunting' and 'owl perched watching prey' over just 'forest " +
          "night'. When the subject can plausibly be filmed in motion, include an action/movement word (flying, " +
          "swimming, running, close-up, slow motion) so results are dynamic footage rather than static scenic " +
          "shots. " +
          broadenInstruction +
          "Reply with ONLY the keyword sets, one per line, max 8 words per line, no quotes/numbering/explanation.",
      },
      { role: "user", content: script },
    ],
    temperature: 0.3,
  });
  const raw = completion.choices[0]?.message?.content?.trim() || "";
  return parseBrollKeywordVariants(raw);
}

// Fungsi MURNI (2026-09-07) - pisahkan parsing dari panggilan AI supaya bisa diuji tanpa
// API beneran. Terima baik hasil deriveBrollKeywordsFromScript (baris per baris) MAUPUN
// array dari generateContent.ts (JSON) - dipanggil dgn tipe input yg sesuai di masing2
// pemanggil (lihat overload penggunaan di generateContent.ts yg langsung terima array).
export function parseBrollKeywordVariants(raw: string): string[] {
  const lines = raw
    .split("\n")
    .map((l) => l.replace(/^[-*\d.)\s]+/, "").trim())
    .filter((l) => l.length > 0);
  return lines.length > 0 ? lines : ["nature scenery"];
}

// Fungsi MURNI (2026-09-07) - validasi hasil AI utk brollKeywords ARRAY dari
// generateContent.ts (JSON, beda jalur dari deriveBrollKeywordsFromScript di atas yg
// balas teks baris-per-baris) - jaring pengaman KODE kalau model balas bukan array
// string atau array kosong, bukan cuma percaya instruksi prompt.
export function parseBrollKeywordArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((k): k is string => typeof k === "string" && k.trim().length > 0).map((k) => k.trim());
}

// Fungsi MURNI (2026-09-07) - pilih keyword variant SECARA BERGANTIAN (round-robin)
// per iterasi loop top-up B-roll (processProject.ts) - modulo supaya aman dipanggil
// berapa kali pun (attemptIndex bisa jauh lebih besar dari jumlah variant yg tersedia,
// lihat maxAttempts di processProject.ts yg diskalakan ke gap durasi). Array kosong =
// fallback netral, sama filosofi dgn fallback lama "nature scenery".
export function pickBrollKeyword(keywords: string[], attemptIndex: number): string {
  if (keywords.length === 0) return "nature scenery";
  return keywords[attemptIndex % keywords.length];
}
