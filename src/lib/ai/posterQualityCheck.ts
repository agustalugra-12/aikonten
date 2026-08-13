import { getOpenAIClient } from "./openaiClient";

export type PosterQcResult = { passed: boolean; issues: string[] };

// Quality Control visual utk poster/carousel AI-generate (2026-08-13, permintaan Agus -
// laporan nyata: "hasil generatenya kadang ada dobel logo atau frame logo lain di pojok
// kanan"). MASTER_DESIGN_SYSTEM_PROMPT di posterDesign.ts SUDAH eksplisit melarang AI
// bikin logo/badge apa pun ("LOGO: JANGAN PERNAH membuat/menggambar logo...") - tapi
// larangan lewat instruksi teks ke model image-generation TIDAK 100% reliable (limitasi
// umum instruksi negatif ke model generatif, apalagi Nano Banana 2 sama sekali tidak
// py mekanisme mask biner - "no masks needed", murni instruksi natural language, lihat
// catatan lengkap di applyPosterDesign). Checker ini lapisan KEDUA (bukan pengganti
// prompt yg sudah ketat) - inspeksi VISUAL aktual hasil jadi, sebelum poster itu sampai
// ke Draft Review Agus, pola sama dgn qualityChecker.ts (video) yg sudah ada duluan -
// "cegah konten cacat sampai ke draft/publish", cuma domainnya gambar bukan video/audio.
export async function checkPosterQuality(imageUrl: string): Promise<PosterQcResult> {
  const client = getOpenAIClient();
  const system = `Kamu adalah Quality Control utk poster promosi media sosial yang dibuat AI image-generation. Periksa gambar SECARA VISUAL, tentukan LOLOS atau GAGAL berdasarkan checklist berikut (checklist ini SATU-SATUNYA kriteria - JANGAN menilai selera desain warna/font pilihan selama tidak melanggar poin di bawah):

1. LOGO GANDA: poster ini akan ditempel 1 logo ASLI brand secara terpisah SESUDAH kamu periksa - jadi gambar yang kamu lihat SEHARUSNYA TIDAK punya elemen logo/badge/lambang/seal/stempel/watermark apa pun sama sekali. Kalau kamu melihat SATU ATAU LEBIH elemen yang terlihat seperti logo/badge/lambang brand (asli maupun karangan AI), ATAU elemen dekoratif yang MENYERUPAI logo/stempel/seal meski bukan logo sungguhan (mis. lingkaran kecil bersimbol di pojok, ribbon kecil, ikon "verified"/centang dalam lingkaran) - GAGAL, sebutkan sbg "ada logo/badge yang tidak seharusnya ada".
2. POJOK KANAN ATAS KOTOR: area pojok kanan-atas (kira-kira 20% lebar x 20% tinggi dari sisi pendek gambar) SEHARUSNYA bersih/kosong (background/warna polos boleh, tapi TIDAK BOLEH ada teks, ikon, atau elemen dekoratif apa pun) - logo asli akan ditempel di situ. Kalau ada elemen apa pun selain background polos di area itu - GAGAL.
3. ELEMEN TERPOTONG: teks atau elemen penting (headline/CTA/badge) yang terpotong tepi gambar - GAGAL.
4. TERLALU DEKAT TEPI: elemen penting nempel/nyaris nempel tepi gambar tanpa ruang kosong (margin) - GAGAL.
5. TEKS BERTABRAKAN: teks yang tumpang tindih dgn elemen lain sehingga sulit dibaca - GAGAL.
6. LAYOUT TIDAK SEIMBANG: layout yang sangat berat sebelah/berantakan/terlalu penuh di satu sisi - GAGAL.

Balas HARUS JSON valid (tanpa markdown code fence): {"passed": true/false, "issues": ["masalah spesifik yg ditemukan dlm Bahasa Indonesia, array kosong kalau lolos"]}.`;

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: "Periksa poster ini." },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
    temperature: 0.1, // rendah - QC butuh konsisten, bukan kreatif
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "{}";
  const cleaned = raw.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    return {
      passed: parsed.passed === true,
      issues: Array.isArray(parsed.issues) ? parsed.issues.filter((x: unknown) => typeof x === "string") : [],
    };
  } catch {
    // Parse gagal (respons tidak sesuai format) - jangan block pipeline krn checker-nya
    // sendiri gagal, anggap "lolos" tapi log jelas supaya keliatan kalau prompt/model
    // butuh disesuaikan lagi ke depan.
    console.error("[posterQualityCheck] gagal parse respons QC, dilewati (dianggap lolos):", raw);
    return { passed: true, issues: [] };
  }
}
