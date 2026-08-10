import { createHash } from "crypto";

// CTA Dinamis (2026-08-10, PRD "AI Content Editing Engine" - "CTA: Subscribe, Like,
// Comment, Next Video, Logo") - SEBELUMNYA satu teks generik hardcode "Follow for
// more!" utk SEMUA video (keputusan sadar waktu itu: konsisten > variasi tak perlu).
// Direvisi di sini krn Agus eksplisit minta lanjut - tapi TETAP proporsional: BUKAN
// panggilan GPT baru per video (mahal, tidak perlu - teks CTA generik bahkan kalau
// GPT-generated tetap akan berulang polanya), cukup rotasi DETERMINISTIK dari pool
// kecil teks yg sudah natural per KONTEKS platform (YouTube long-form beda budaya dari
// Shorts/Reels - "Subscribe" utk YouTube, "Follow" utk Shorts/TikTok/Reels, sesuai
// konvensi platform masing2 - PRD sendiri list "Subscribe" & "Like"/"Comment" sbg CTA
// beda, bukan satu kata generik semua platform). "Next Video"/"Comment" SENGAJA belum
// masuk pool (lihat catatan di bawah pickCtaText) - "Next Video" perlu tahu judul
// episode BERIKUTNYA yg belum tentu ada/sudah digenerate saat video ini dirender
// (Series/Topic Rotation baru assign episode selanjutnya belakangan), "Comment"
// sbg CTA butuh pertanyaan spesifik konten (mis. "komentar pengalamanmu di X") biar
// tidak terasa asal-tempel - keduanya perlu konteks lebih dari yg proporsional utk
// v1 ini, bukan cuma rotasi teks statis lagi.
export type CtaContext = "youtube_longform" | "youtube_shorts" | "generic";

const CTA_POOLS: Record<CtaContext, string[]> = {
  // YouTube long-form - konvensi platform: "Subscribe", BUKAN "Follow".
  youtube_longform: [
    "Subscribe for more!",
    "Hit subscribe to catch the next one!",
    "Subscribe & like if you enjoyed this!",
  ],
  // YouTube Shorts - budaya CTA lebih dekat ke Shorts/Reels tapi tetap "Subscribe"
  // (aksi native YouTube, bukan "Follow" yg istilah Instagram/TikTok).
  // BUG NYATA (2026-08-10, ditemukan lewat render sungguhan Animal Story & Co, bukan
  // review kode) - "Subscribe so you don't miss out!" (apostrof di "don't") merusak
  // parsing "-filter_complex" drawtext: escaping di overlayEngine.ts (`\\'`) TIDAK
  // cukup di konteks filter_complex bertingkat sebanyak ini (banyak filter di-chain
  // via ";"), ffmpeg salah baca sisa string sbg nama filter baru ("No such filter:
  // '39.51)'"), render GAGAL TOTAL. Fix: hindari apostrof SAMA SEKALI di pool CTA
  // (bukan perbaiki escaping-nya - lebih aman & permanen drpd berharap escaping
  // sempurna di semua kedalaman filter_complex kombinasi manapun).
  youtube_shorts: ["Subscribe for more!", "Tap subscribe for daily shorts!", "Subscribe to never miss out!"],
  // Konten non-YouTube (IG/TikTok/FB Reels via Buffer) - konvensi platform: "Follow".
  generic: ["Follow for more!", "Like & follow for more!", "Save this & follow for more!"],
};

// Rotasi DETERMINISTIK berbasis hash projectId (2026-08-10) - BUKAN random murni:
// project yg SAMA (mis. di-render ulang stlh gagal) SELALU dapat CTA yg SAMA
// (konsisten, tidak berubah-ubah tiap retry), tapi project BEDA (id beda) tersebar
// merata ke seluruh pool - variasi nyata lintas video tanpa perlu simpan state
// "CTA terakhir dipakai" di DB.
export function pickCtaText(projectId: string, context: CtaContext): string {
  const pool = CTA_POOLS[context];
  const hash = createHash("md5").update(projectId).digest();
  const index = hash[0] % pool.length;
  return pool[index];
}
