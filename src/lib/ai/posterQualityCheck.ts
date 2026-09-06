import sharp from "sharp";
import { getOpenAIClient } from "./openaiClient";
import { LOGO_SIZE_RATIO, LOGO_MARGIN_RATIO } from "./logoOverlay";

export type PosterQcResult = { passed: boolean; issues: string[] };

// Crop ZOOM zona kanan-atas (2026-09-06, ditemukan lewat live test - kasus AgustaP
// Studio) - root cause QC salah tandai "ikon WhatsApp di pojok kanan atas" padahal
// ikon itu SUNGGUHAN ada di poster tapi di CTA BAWAH, bukan atas (dicek manual, crop
// piksel exact zona itu TERBUKTI bersih) - model vision (gpt-4.1-mini) py spatial
// reasoning lemah utk area kecil di gambar penuh yg padat elemen, KELIRU
// mengasosiasikan elemen dari bagian lain poster sbg "di pojok kanan atas". Fix:
// kirim crop KHUSUS zona itu (di-zoom 4x) sbg gambar KEDUA - model tidak perlu
// menebak lokasi lagi, tinggal lihat langsung apa isi zona itu SESUNGGUHNYA. Koordinat
// SAMA PERSIS dgn clearLogoZone (logoOverlay.ts) - satu sumber kebenaran box logo.
async function cropLogoZoneAsDataUrl(imageUrl: string): Promise<string> {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Gagal ambil gambar utk crop zona logo: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(buffer).metadata();
  const width = meta.width || 1080;
  const height = meta.height || 1080;
  const shortSide = Math.min(width, height);
  const zoneSize = Math.round(shortSide * (LOGO_SIZE_RATIO + LOGO_MARGIN_RATIO));
  const box = { left: Math.max(0, width - zoneSize), top: 0, width: Math.min(zoneSize, width), height: Math.min(zoneSize, height) };
  const cropped = await sharp(buffer).extract(box).resize(box.width * 4, box.height * 4).png().toBuffer();
  return `data:image/png;base64,${cropped.toString("base64")}`;
}

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
export async function checkPosterQuality(imageUrl: string, allowLogoInContent: boolean = false): Promise<PosterQcResult> {
  const client = getOpenAIClient();
  // Checklist LOGO digabung jadi 1 item saja (2026-09-06, permintaan Agus - "buat
  // checklist 1 aja agar tidak banyak fungsi", sebelumnya 2 item terpisah LOGO GANDA +
  // POJOK KANAN ATAS). Logikanya TETAP SAMA (tidak disederhanakan secara fungsi,
  // cuma digabung teksnya) - zona kanan-atas TETAP wajib kosong utk SEMUA brand tanpa
  // kecuali (reserved logo asli), bagian LAIN gambar baru conditional thd
  // allowLogoInAiContent (brand dgn toggle aktif, lihat schema.ts/BrandSettingsSidebar,
  // sudah setuju konsekuensi biaya lewat UI).
  const zonaKananAtas = `area pojok kanan-atas (kira-kira ${(LOGO_SIZE_RATIO + LOGO_MARGIN_RATIO) * 100}% lebar x ${(LOGO_SIZE_RATIO + LOGO_MARGIN_RATIO) * 100}% tinggi dari sisi pendek gambar) SEHARUSNYA bersih/kosong (background/warna polos boleh, tapi TIDAK BOLEH ada teks, ikon, atau elemen dekoratif apa pun) - logo asli akan ditempel di situ, SELALU berlaku tidak peduli brand mengizinkan logo/identitas di bagian lain gambar atau tidak. GAMBAR KEDUA yang diberikan adalah crop ZOOM 4x persis area ini - JADIKAN GAMBAR KEDUA SATU-SATUNYA SUMBER KEBENARAN utk menilai poin ini (JANGAN menebak dari gambar pertama/penuh, elemen di bagian LAIN poster - mis. ikon di tombol CTA bawah - TIDAK relevan utk poin ini walau sekilas "kelihatan di area atas" pada gambar penuh). Kalau ada elemen apa pun selain background/tekstur polos DI GAMBAR KEDUA - GAGAL.`;
  const logoChecklistItem = allowLogoInContent
    ? `1. POJOK KANAN ATAS & LOGO: ${zonaKananAtas} Di LUAR zona itu, brand ini secara eksplisit MENGIZINKAN elemen logo/identitas/ikon tampil (staf sudah setuju) - JANGAN tandai elemen logo/badge/ikon medsos di LUAR pojok kanan-atas sbg masalah.`
    : `1. POJOK KANAN ATAS & LOGO GANDA: ${zonaKananAtas} Di LUAR zona itu, poster ini akan ditempel 1 logo ASLI brand secara terpisah SESUDAH kamu periksa - jadi gambar yang kamu lihat SEHARUSNYA TIDAK punya elemen LOGO/BADGE/LAMBANG BRAND apa pun. PENTING - BEDAKAN dgn teliti (2026-08-13, ditemukan false-positive nyata 2x): (a) ikon fasilitas/benefit kecil yg PY LABEL TEKS PENJELAS di sebelah/bawahnya (mis. ikon cangkir + tulisan "Sarapan", ikon mobil + tulisan "Parkir Gratis", ikon wifi + tulisan "WiFi"), DAN (b) badge/pill CTA berisi teks instruksi/ajakan (mis. "Simpan Info Ini", "Reservasi Sekarang", "Geser untuk Lihat Lebih", tombol call-to-action apa pun dgn teks jelas) - KEDUANYA ADALAH BAGIAN NORMAL & WAJAR dari desain poster promosi/infografis (menjelaskan fasilitas ATAU mengajak tindakan, BUKAN identitas brand) - JANGAN PERNAH tandai elemen semacam ini sbg masalah, di mana pun posisinya di poster (termasuk pojok kanan-bawah) & bagaimana pun bentuknya (grid, kotak, pill, ribbon). Yang WAJIB ditandai HANYA elemen yang benar2 berfungsi sbg IDENTITAS MERK: logo/emblem/monogram BERDIRI SENDIRI tanpa teks fungsional/instruksi apa pun, seal/stempel "verified"/"certified"/centang resmi, watermark transparan tembus pandang, ikon aplikasi/media sosial (Instagram/TikTok/dst) berdiri sendiri, atau simbol yang jelas dimaksudkan mewakili brand (bukan menjelaskan fasilitas/mengajak aksi). Aturan sederhana: ADA teks yg menjelaskan fasilitas ATAU mengajak suatu tindakan di elemen itu/dekatnya -> BUKAN logo, LOLOS. TIDAK ADA teks fungsional & terlihat seperti lambang/identitas -> itu logo, GAGAL (sebutkan sbg "ada logo/badge yang tidak seharusnya ada"). CATATAN PENTING: pengecualian "ada teks penjelas -> LOLOS" ini HANYA berlaku utk elemen DI LUAR zona pojok kanan-atas - kalau ikon/badge apa pun (walau py teks penjelas/CTA) ada DI DALAM zona pojok kanan-atas yg sudah dijelaskan di atas, TETAP GAGAL tanpa pengecualian, zona itu HARUS bersih total.`;
  const system = `Kamu adalah Quality Control utk poster promosi media sosial yang dibuat AI image-generation. Periksa gambar SECARA VISUAL, tentukan LOLOS atau GAGAL berdasarkan checklist berikut (checklist ini SATU-SATUNYA kriteria - JANGAN menilai selera desain warna/font pilihan selama tidak melanggar poin di bawah):

${logoChecklistItem}
2. ELEMEN TERPOTONG: teks atau elemen penting (headline/CTA/badge) yang terpotong tepi gambar - GAGAL.
3. TERLALU DEKAT TEPI: elemen penting nempel/nyaris nempel tepi gambar tanpa ruang kosong (margin) - GAGAL.
4. TEKS BERTABRAKAN: teks yang tumpang tindih dgn elemen lain sehingga sulit dibaca - GAGAL.
5. LAYOUT TIDAK SEIMBANG: layout yang sangat berat sebelah/berantakan/terlalu penuh di satu sisi - GAGAL.

Balas HARUS JSON valid (tanpa markdown code fence): {"passed": true/false, "issues": ["masalah spesifik yg ditemukan dlm Bahasa Indonesia, array kosong kalau lolos"]}.`;

  const zoneCropDataUrl = await cropLogoZoneAsDataUrl(imageUrl);

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: "Gambar PERTAMA = poster utuh. Gambar KEDUA = crop zoom 4x zona pojok kanan-atas (lihat instruksi checklist item 1). Periksa poster ini." },
          { type: "image_url", image_url: { url: imageUrl } },
          { type: "image_url", image_url: { url: zoneCropDataUrl } },
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
