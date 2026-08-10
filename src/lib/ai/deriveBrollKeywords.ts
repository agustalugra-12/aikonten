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
export async function deriveBrollKeywordsFromScript(script: string): Promise<string> {
  const client = getOpenAIClient();
  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content:
          "Convert this content idea/script (any language) into 2-4 short English keywords to search for " +
          "stock video footage. PRIORITIZE the SPECIFIC concrete subject the script is actually about (a named " +
          "animal, object, place, or activity) over vague mood/scenery words - e.g. for a script about how owls " +
          "hunt at night, prefer 'owl flying night hunting' over just 'forest night'. When the subject can " +
          "plausibly be filmed in motion, include an action/movement word (flying, swimming, running, close-up, " +
          "slow motion) so the result is dynamic footage rather than a static scenic shot. " +
          "Reply with ONLY the keywords (max 8 words total), no quotes/explanation.",
      },
      { role: "user", content: script },
    ],
    temperature: 0.3,
  });
  return completion.choices[0]?.message?.content?.trim() || "nature scenery";
}
