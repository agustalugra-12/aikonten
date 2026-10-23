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
  // (2026-09-29, Opsi B) Zona pojok kanan-atas TIDAK lagi wajib kosong - reservasi zona itu
  // justru penyebab kotak placeholder (lihat logoOverlay.ts/posterDesign.ts). Poster sekarang
  // full-bleed & natural sampai ke pojok; logo ASLI (lingkaran kecil) ditumpuk terpisah SESUDAH
  // QC. QC fokus ke masalah nyata: LOGO GANDA (Gemini menggambar sendiri lambang identitas brand),
  // bukan lagi "pojok harus bersih". Distingsi ikon-fasilitas/CTA vs identitas-merk tetap dijaga.
  const logoChecklistItem = allowLogoInContent
    ? `1. LOGO/IDENTITAS: brand ini secara eksplisit MENGIZINKAN elemen logo/identitas/ikon tampil (staf sudah setuju) - JANGAN tandai elemen logo/badge/ikon medsos sbg masalah di mana pun. Poster boleh full-bleed/natural sampai ke semua pojok - itu normal, BUKAN masalah. TAPI HANYA kalau di POJOK KANAN-ATAS ada area TRANSPARAN (pola checkerboard) ATAU kartu/panel/kotak dgn TEPI/BINGKAI JELAS yang floating & KOSONG (tanpa teks fungsional) = artefak "tempat logo", GAGAL (sebut "ada kotak/kartu placeholder di pojok kanan-atas"). Background polos terang/putih/gradient tanpa tepi terlihat = LOLOS (bukan kartu).`
    : `1. LOGO GANDA: poster ini akan ditempel 1 logo ASLI brand secara terpisah SESUDAH kamu periksa (lingkaran kecil di pojok kanan-atas) - jadi gambar yang kamu lihat SEHARUSNYA TIDAK punya elemen LOGO/BADGE/LAMBANG BRAND yang berdiri sendiri (hindari logo ganda). PENTING - BEDAKAN dgn teliti (2026-08-13, ditemukan false-positive nyata 2x): (a) ikon fasilitas/benefit kecil yg PY LABEL TEKS PENJELAS di sebelah/bawahnya (mis. ikon cangkir + tulisan "Sarapan", ikon mobil + tulisan "Parkir Gratis", ikon wifi + tulisan "WiFi"), DAN (b) badge/pill CTA berisi teks instruksi/ajakan (mis. "Simpan Info Ini", "Reservasi Sekarang", tombol call-to-action apa pun dgn teks jelas) - KEDUANYA ADALAH BAGIAN NORMAL & WAJAR dari desain poster promosi/infografis (menjelaskan fasilitas ATAU mengajak tindakan, BUKAN identitas brand) - JANGAN PERNAH tandai elemen semacam ini sbg masalah, di mana pun posisinya di poster & bagaimana pun bentuknya (grid, kotak, pill, ribbon). Poster boleh full-bleed/natural sampai ke semua pojok termasuk kanan-atas - itu normal, BUKAN masalah. Yang WAJIB ditandai HANYA elemen yang benar2 berfungsi sbg IDENTITAS MERK: logo/emblem/monogram BERDIRI SENDIRI tanpa teks fungsional/instruksi apa pun, seal/stempel "verified"/"certified"/centang resmi, watermark transparan tembus pandang, ikon aplikasi/media sosial (Instagram/TikTok/dst) berdiri sendiri, atau simbol yang jelas dimaksudkan mewakili brand (bukan menjelaskan fasilitas/mengajak aksi). Aturan sederhana: ADA teks yg menjelaskan fasilitas ATAU mengajak suatu tindakan di elemen itu/dekatnya -> BUKAN logo, LOLOS. TIDAK ADA teks fungsional & terlihat seperti lambang/identitas -> itu logo, GAGAL (sebutkan sbg "ada logo/badge yang tidak seharusnya ada"). ARTEFAK PLACEHOLDER (spesifik & sempit - hati2 false-positive): tandai GAGAL HANYA kalau di POJOK KANAN-ATAS ada (a) area TRANSPARAN dgn pola kotak-kotak/checkerboard, ATAU (b) KARTU/PANEL/KOTAK dgn TEPI/BINGKAI/BAYANGAN JELAS yang berdiri sendiri sbg objek floating terpisah, KOSONG tanpa teks fungsional, jelas seperti "tempat logo". LOLOS (BUKAN masalah): background/header polos terang/putih/gradient TANPA tepi/bingkai yang terlihat - area latar mulus itu NORMAL walau logo asli nanti ditumpuk di situ, BUKAN kartu. Kalau ragu latar-polos vs kartu-floating, anggap LATAR (LOLOS).`;
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
          { type: "text", text: "Gambar PERTAMA = poster utuh. Gambar KEDUA = crop zoom 4x pojok kanan-atas (detail utk bantu deteksi logo ganda/lambang identitas). Periksa poster ini." },
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
