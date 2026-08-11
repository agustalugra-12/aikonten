import { getOpenAIClient } from "./openaiClient";
import { validatePriceClaims, stripInvalidPrices } from "./priceValidator";

export type PosterCopy = {
  headline: string;
  subheadline: string | null;
  harga: string | null;
  cta: string;
  benefits: string[];
  isiTulisan: string | null;
};

// Teks yang DITEMPEL DI POSTER (headline/CTA/badge harga) - BEDA dari caption sosmed
// (generateContent.ts, itu teks di luar gambar, tempat postingnya). Dipanggil khusus utk
// jalur poster foto tunggal (2026-08-05, master prompt "Pelangi Homestay Poster Design
// System v1" dari Agus) - lihat posterDesign.ts utk cara teks ini ditempel ke gambar.
//
// BUG NYATA (2026-08-11, laporan Agus - poster "laundry in bali" tampil harga
// "Rp100.000"/"50K" padahal daftar harga ASLI brand ini TIDAK PUNYA angka segitu sama
// sekali [harga asli: Rp5.000-11.000/kg, Rp20.000-35.000 per item, lihat
// brands.manualKnowledge]). Akar masalah dicek LANGSUNG di prompt di bawah (bukan
// tebak): instruksi field `harga` dulu kasih CONTOH ANGKA KONKRET ("Rp100.000"/"Mulai
// 100K") - gpt-4.1-mini terbukti kadang menyalin literal angka contoh itu drpd
// memperlakukannya sbg placeholder format, WALAU instruksi yg sama eksplisit bilang
// "JANGAN mengarang harga" (contoh dgn angka nyata mengalahkan instruksi larangan,
// pola gagal umum LLM - example anchoring). Fix DUA lapis: (1) contoh diganti jadi
// PLACEHOLDER huruf ("RpXX.000"), bukan angka asli yg bisa disalin, (2) daftar harga
// RESMI brand (manualKnowledge) diberikan sbg konteks - harga WAJIB persis salah satu
// dari situ, bukan cuma "masuk akal".
export async function generatePosterCopy(
  brandName: string,
  script: string,
  manualKnowledge?: string | null
): Promise<PosterCopy> {
  const client = getOpenAIClient();
  const system =
    "Kamu copywriter marketing hospitality/jasa. Dari skrip/ide konten, buat teks-teks singkat utk " +
    "ditempel di POSTER PROMOSI (bukan caption sosmed, ini teks YANG MUNCUL DI DALAM gambar): " +
    "headline (3-6 kata, catchy, Bahasa Indonesia), subheadline (opsional, 1 kalimat pendek, null " +
    "kalau tidak perlu), harga (versi SANGAT singkat, FORMAT CONTOH 'RpXX.000' atau 'Mulai RpXX.000' " +
    "- XX HANYA placeholder format, JANGAN pernah dipakai sbg angka sungguhan), cta (2-4 kata, huruf " +
    "besar, mis. 'BOOK NOW'/'RESERVASI SEKARANG'/'PESAN HARI INI'), benefits (array 2-4 fasilitas/" +
    "keunggulan SANGAT singkat yg relevan dari skrip, mis. ['Wifi Gratis','Sarapan','Kolam Renang'], " +
    "array kosong kalau tidak ada yg relevan disebut), isiTulisan (1 kalimat pendek tambahan kalau " +
    "perlu, null kalau headline+harga+cta sudah cukup jelas). ATURAN KERAS utk field `harga`: HANYA " +
    "boleh diisi kalau nilainya PERSIS SAMA (angka & satuannya) dgn salah satu harga di DAFTAR HARGA " +
    "RESMI yang diberikan di bawah (kalau ada) DAN skrip/ide ini jelas membahas layanan itu - kalau " +
    "tidak ada Daftar Harga Resmi diberikan, atau skrip tidak menyebut/merujuk harga spesifik apa " +
    "pun, atau kamu TIDAK YAKIN, kembalikan null. JANGAN PERNAH mengarang, membulatkan, atau " +
    "menaksir angka harga sendiri.";
  const knowledgeBlock = manualKnowledge?.trim()
    ? `\n\nDAFTAR HARGA RESMI (satu-satunya sumber angka yg BOLEH dipakai di field harga):\n${manualKnowledge.trim()}\n`
    : "\n\n(Tidak ada daftar harga resmi diberikan - field harga WAJIB null.)\n";
  const user =
    `Brand: ${brandName}\n\nSkrip/ide:\n${script}${knowledgeBlock}\nBalas HARUS JSON valid (tanpa markdown code ` +
    `fence): {"headline":"...","subheadline":"..." atau null,"harga":"..." atau null,"cta":"...",` +
    `"benefits":["..."],"isiTulisan":"..." atau null}`;

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.7,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "{}";
  const cleaned = raw.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
  const parsed = JSON.parse(cleaned);
  // Pertahanan lapis ke-3 (kode, bukan cuma prompt) - kalau manualKnowledge TIDAK
  // mengandung angka harga yg persis diklaim GPT, buang jadi null drpd percaya penuh
  // pada instruksi prompt (pola yg sama dipakai berkali2 di project ini - lihat
  // catatan apostrof di statExtractor.ts, iconCategory validation, dll). Pakai
  // priceValidator.ts bersama (2026-08-11) - SATU sumber logic validasi harga, dipakai
  // jg di processProject.ts utk caption/promoText/thumbnailText, bukan duplikat di sini.
  let harga: string | null = parsed.harga || null;
  if (harga && !validatePriceClaims(harga, manualKnowledge).valid) {
    harga = null;
  }
  // Field bebas LAIN (2026-08-11, gap nyata ditemukan lewat tes render - poster
  // "laundry in bali" nampilkan "Cuci Komplit Rp7.000/kg" sbg salah satu `benefits`,
  // KEBETULAN harga ASLI yg benar, tapi field ini TIDAK PERNAH divalidasi sama sekali
  // sebelum ini - GPT bebas menaruh harga apa pun di sini tanpa lolos gate `harga`.
  // subheadline/isiTulisan jg free-text, sama risikonya - semua di-strip konsisten.
  const benefits = (Array.isArray(parsed.benefits) ? parsed.benefits : []).map((b: unknown) =>
    typeof b === "string" ? stripInvalidPrices(b, manualKnowledge) : b
  );
  const subheadline = parsed.subheadline ? stripInvalidPrices(parsed.subheadline, manualKnowledge) : null;
  const isiTulisan = parsed.isiTulisan ? stripInvalidPrices(parsed.isiTulisan, manualKnowledge) : null;
  return {
    headline: parsed.headline || brandName,
    subheadline: subheadline || null,
    harga,
    cta: parsed.cta || "BOOK NOW",
    benefits,
    isiTulisan: isiTulisan || null,
  };
}
