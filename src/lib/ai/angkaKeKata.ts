// Konversi angka numerik → kata Bahasa Indonesia untuk voiceover TTS
// (2026-08-22, PRD "Update AI Konten — Script & Footage" v1.1 §1: script yang masuk
// ke TTS TIDAK BOLEH mengandung angka numerik - semua angka WAJIB jadi tulisan:
// "5 tips"→"lima tips", "30 detik"→"tiga puluh detik", "30%"→"tiga puluh persen",
// "Rp175.000"→"seratus tujuh puluh lima ribu rupiah", "2026"→"dua ribu dua puluh enam".
// Angka tetap boleh di metadata/system data, HANYA tidak boleh di voiceover.)

const SATUAN = [
  "nol", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan",
  "sembilan", "sepuluh", "sebelas",
];

// Angka bulat 0..999.999.999.999 → kata Indonesia (standar ejaan, tanpa tanda hubung)
export function angkaBulatKeKata(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (n < 0) return `minus ${angkaBulatKeKata(-n)}`;
  if (n <= 11) return SATUAN[n];
  if (n < 20) return `${SATUAN[n - 10]} belas`;
  if (n < 100) {
    const p = Math.floor(n / 10), s = n % 10;
    return `${SATUAN[p]} puluh${s ? ` ${SATUAN[s]}` : ""}`;
  }
  if (n < 200) return `seratus${n % 100 ? ` ${angkaBulatKeKata(n % 100)}` : ""}`;
  if (n < 1000) {
    const r = Math.floor(n / 100), s = n % 100;
    return `${SATUAN[r]} ratus${s ? ` ${angkaBulatKeKata(s)}` : ""}`;
  }
  if (n < 2000) return `seribu${n % 1000 ? ` ${angkaBulatKeKata(n % 1000)}` : ""}`;
  if (n < 1_000_000) {
    const r = Math.floor(n / 1000), s = n % 1000;
    return `${angkaBulatKeKata(r)} ribu${s ? ` ${angkaBulatKeKata(s)}` : ""}`;
  }
  if (n < 1_000_000_000) {
    const r = Math.floor(n / 1_000_000), s = n % 1_000_000;
    return `${angkaBulatKeKata(r)} juta${s ? ` ${angkaBulatKeKata(s)}` : ""}`;
  }
  const r = Math.floor(n / 1_000_000_000), s = n % 1_000_000_000;
  return `${angkaBulatKeKata(r)} miliar${s ? ` ${angkaBulatKeKata(s)}` : ""}`;
}

// Desimal koma gaya Indonesia: "3,5" → "tiga koma lima"
function desimalKeKata(bulat: number, pecahanDigits: string): string {
  const pecahan = pecahanDigits
    .split("")
    .map((d) => SATUAN[Number(d)])
    .join(" ");
  return `${angkaBulatKeKata(bulat)} koma ${pecahan}`;
}

// Deret digit dibaca satu-satu ("delapan lima satu") - untuk rentetan digit yang BUKAN
// bilangan (nomor telepon/rekening, >12 digit di luar jangkauan angkaBulatKeKata).
function digitSatuSatu(digits: string): string {
  return digits.split("").map((d) => SATUAN[Number(d)]).join(" ");
}

// Pola angka dalam teks (urutan penting: spesifik dulu)
// - Rp175.000 / Rp 175.000 / Rp175 → rupiah
// - 30% / 30 % → persen
// - 3,5 → desimal koma
// - 1.000 → ribuan (titik = separator, bukan desimal)
// - 2026 → tahun/bulat biasa
// - 45-60 → rentang dibaca per sisi ("empat lima sampai enam puluh" SALAH;
//   lebih aman konversi tiap sisi terpisah: "empat puluh lima sampai enam puluh")
//
// Kata besaran di BELAKANG nominal ikut diserap: "Rp1,5 juta" dulu terbaca "satu koma lima
// rupiah juta" (urutan kacau) dan "Rp150rb" menyisakan "rb" yang dibaca "er-be". "M"
// SENGAJA tidak ikut: di Bahasa Indonesia ambigu (juta vs miliar) dan ini jalur uang.
const RE_RUPIAH = /\brp\.?\s*(\d{1,12}(?:\.\d{3})*(?:,\d+)?)(?:\s*(ribu|rb|juta|jt|miliar))?\b/gi;
const BESARAN: Record<string, string> = {
  ribu: "ribu", rb: "ribu", juta: "juta", jt: "juta", miliar: "miliar",
};
const RE_PERSEN = /(\d{1,3}(?:\.\d{3})*)\s*%/g;
// Desimal HANYA bila pecahannya 1-2 digit ("3,5" / "12,75"). Koma + 3 digit = pemisah RIBUAN gaya
// Inggris ("350,000"), BUKAN desimal - dulu terbaca "tiga ratus koma nol nol nol" (cacat nyata "000").
const RE_DESIMAL = /(\d{1,9}),(\d{1,2})(?!\d)/g;
// Ribuan bergaya KOMA: 350,000 / 1,250,000 -> dinormalkan ke digit polos sebelum aturan lain.
const RE_RIBUAN_KOMA = /\b\d{1,3}(?:,\d{3})+\b/g;
const RE_RIBUAN = /\b\d{1,3}(?:\.\d{3})+\b/g; // 1.000 / 175.500 (min satu titik grup 3 digit)
// Slang Indonesia: 150k / 150K / 150rb / 150RB = seratus lima puluh ribu
const RE_SLANG_RIBU = /\b(\d{1,9})\s*(k|rb)\b/gi;
const RE_BULAT = /\d+/g;

// --- 2026-11-07: bentuk yang dulu lolos mentah ke TTS (bukti nyata: caption laundry yang
// SUDAH TERBIT "cuci komplit Rp7.000/kg" terdengar "Gunang anggar tekanan kilogram",
// nilai harganya hilang total) ---

// Angka emoji keycap: 1️⃣ = U+0031 U+FE0F U+20E3. Digitnya ikut terkonversi, tapi
// variation-selector + enclosing-keycap TERTINGGAL -> TTS mengucap sampah ("satu️⃣").
// Caption (generated_caption, sumber narasi utk 4 dari 5 brand) sering memakai 1️⃣2️⃣3️⃣.
const RE_KEYCAP = /([0-9])️?⃣/g;
// Satuan di belakang garis miring: "Rp7.000/kg" -> "...rupiah per kilogram".
const RE_SATUAN_SLASH = /(\d)\s*\/\s*([A-Za-z²³]{1,15})(?![A-Za-z])/g;
const SINGKATAN_SATUAN: Record<string, string> = {
  kg: "kilogram", g: "gram", gr: "gram", mg: "miligram",
  l: "liter", ltr: "liter", ml: "mililiter",
  m: "meter", km: "kilometer", cm: "sentimeter", mm: "milimeter",
  m2: "meter persegi", "m²": "meter persegi", "m³": "meter kubik",
  pcs: "buah", pc: "buah", pax: "orang",
  thn: "tahun", bln: "bulan", hr: "hari", mnt: "menit", dtk: "detik",
  kwh: "kilowatt jam", mbps: "megabit per detik",
};
// Varian "Rp1,5 juta/bulan": yang mendahului garis miring KATA, bukan digit. Hanya satuan
// dalam daftar putih yang diubah, supaya "check-in/out" dan "villa/homestay" TAK tersentuh.
const SATUAN_PUTIH =
  "kg|gram|gr|liter|ltr|ml|bulan|bln|hari|hr|minggu|tahun|thn|jam|menit|mnt|detik|dtk|orang|pax|malam|porsi|pcs|unit|item|konten|video|post|kali|km|cm|m2";
const RE_SATUAN_SLASH_KATA = new RegExp(
  `(\\p{L})\\s*/\\s*(${SATUAN_PUTIH})(?![\\p{L}])`, "giu");
// Rentang: 5-10 / 5–10 (en dash) / 5—10 (em dash) -> "lima sampai sepuluh".
// Sengaja dibatasi grup 1-3 digit (+ titik ribuan) supaya nomor telepon "0851-1934-9960"
// dan rentang tahun "2026-2027" TIDAK ikut berubah jadi "sampai".
const RE_RENTANG =
  /(?<![\d.,\-–—])(\d{1,3}(?:\.\d{3})*)\s*[-–—]\s*((?:[Rr]p\.?\s*)?\d{1,3}(?:\.\d{3})*)(?![\d.,\-–—])/g;
// Rentang JAM ("08.00-22.00") tak tertangkap RE_RENTANG (pecahan 2 digit, bukan ribuan).
const RE_RENTANG_JAM = /(?<=\d[.:]\d\d)\s*[-–—]\s*(?=\d)/g;
// Jam: 08.00 / 08:30. CATATAN PENTING: titik di sini BUKAN pemisah ribuan. Lookahead hanya
// menolak titik/koma yang DIIKUTI digit, jadi "pukul 12.00." di akhir kalimat tetap kena
// (dulu terlewat -> "dua belas.nol"), sementara "1.000.000", "Rp350.000" dan tanggal
// "7.11.2026" tetap milik RE_RIBUAN/RE_RUPIAH.
const RE_JAM = /(?<![\d.,:])([01]?\d|2[0-3])[.:]([0-5]\d)(?!\d|[.,:]\d)/g;

function bersihkanSpasiGanda(t: string): string {
  return t.replace(/[ \t]{2,}/g, " ").trim();
}

/**
 * Konversi SEMUA angka numerik dalam teks menjadi kata Bahasa Indonesia.
 * Aman dipanggil berulang (idempoten pada teks yang sudah bebas digit).
 */
export function angkaKeKata(text: string): string {
  let out = text ?? "";

  // 0. Normalisasi bentuk non-bilangan DULU (hasilnya masih berdigit, biar aturan di bawah
  //    yang mengubahnya jadi kata). Urutan: keycap -> satuan/garis-miring -> rentang.
  out = out.replace(RE_KEYCAP, "$1 ");
  out = out.replace(RE_SATUAN_SLASH, (_m, d: string, unit: string) =>
    `${d} per ${SINGKATAN_SATUAN[unit.toLowerCase()] ?? unit}`);
  out = out.replace(RE_SATUAN_SLASH_KATA, (_m, pre: string, unit: string) =>
    `${pre} per ${SINGKATAN_SATUAN[unit.toLowerCase()] ?? unit.toLowerCase()}`);
  out = out.replace(RE_RENTANG, "$1 sampai $2");
  out = out.replace(RE_RENTANG_JAM, " sampai ");

  // 0b. Normalisasi pemisah ribuan gaya KOMA (Inggris) -> digit polos, SEBELUM aturan desimal.
  //    "Rp350,000" / "350,000" / "1,250,000" dulu kena aturan desimal -> "koma nol nol nol".
  out = out.replace(RE_RIBUAN_KOMA, (m: string) => m.replace(/,/g, ""));

  // 1. Rupiah: Rp175.000 → seratus tujuh puluh lima ribu rupiah
  out = out.replace(RE_RUPIAH, (_m, digits: string, besaran?: string) => {
    const clean = digits.replace(/\./g, "");
    const skala = besaran ? ` ${BESARAN[besaran.toLowerCase()]}` : "";
    // Koma = desimal HANYA bila pecahan 1-2 digit; 3 digit = ribuan (sudah dinormalkan di langkah 0b;
    // ini jaring pengaman bila pola lolos, mis. "Rp1.250,000").
    if (digits.includes(",")) {
      const [i, d] = digits.split(",");
      if (d && d.length <= 2) return `${desimalKeKata(Number(i.replace(/\./g, "")), d)}${skala} rupiah`;
      return `${angkaBulatKeKata(Number(digits.replace(/[.,]/g, "")))}${skala} rupiah`;
    }
    return `${angkaBulatKeKata(Number(clean))}${skala} rupiah`;
  });

  // 2. Persen: 30% → tiga puluh persen
  out = out.replace(RE_PERSEN, (_m, digits: string) =>
    `${angkaBulatKeKata(Number(digits.replace(/\./g, "")))} persen`);

  // 2b. Derajat: 30°C → tiga puluh derajat celsius (°C/°F dulu, lalu ° telanjang)
  out = out.replace(/(\d)\s*°\s*C(?![A-Za-z])/gi, "$1 derajat celsius");
  out = out.replace(/(\d)\s*°\s*F(?![A-Za-z])/gi, "$1 derajat fahrenheit");
  out = out.replace(/(\d)\s*°/g, "$1 derajat ");

  // 3. Desimal koma: 3,5 → tiga koma lima
  out = out.replace(RE_DESIMAL, (_m, i: string, d: string) => desimalKeKata(Number(i), d));

  // 3b. Jam: 08.00 → delapan, 08:30 → delapan tiga puluh (SEBELUM ribuan/bulat)
  out = out.replace(RE_JAM, (_m, jam: string, menit: string) => {
    const j = angkaBulatKeKata(Number(jam));
    return Number(menit) === 0 ? j : `${j} ${angkaBulatKeKata(Number(menit))}`;
  });

  // 4. Ribuan bertitik: 1.000 → seribu (SEBELUM pola bulat polos)
  out = out.replace(RE_RIBUAN, (m: string) => angkaBulatKeKata(Number(m.replace(/\./g, ""))));

  // 4b. Slang ribu: 150k / 150rb → seratus lima puluh ribu
  out = out.replace(RE_SLANG_RIBU, (_m: string, digits: string) => `${angkaBulatKeKata(Number(digits))} ribu`);

  // 5. Bulat polos: 5 → lima, 2026 → dua ribu dua puluh enam.
  //    >12 digit = bukan bilangan (nomor telepon/rekening) → dibaca satu-satu; yang penting,
  //    TIDAK PERNAH ada digit tersisa yang menggagalkan gerbang QC di processProject.
  out = out.replace(RE_BULAT, (m: string) =>
    m.length > 12 ? digitSatuSatu(m) : angkaBulatKeKata(Number(m)));

  return bersihkanSpasiGanda(out);
}

/** QC gate PRD §5: true kalau MASIH ada digit numerik tersisa di teks voiceover. */
export function adaAngkaTersisa(text: string): boolean {
  return /\d/.test(text ?? "");
}
