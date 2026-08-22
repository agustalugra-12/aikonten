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

// Pola angka dalam teks (urutan penting: spesifik dulu)
// - Rp175.000 / Rp 175.000 / Rp175 → rupiah
// - 30% / 30 % → persen
// - 3,5 → desimal koma
// - 1.000 → ribuan (titik = separator, bukan desimal)
// - 2026 → tahun/bulat biasa
// - 45-60 → rentang dibaca per sisi ("empat lima sampai enam puluh" SALAH;
//   lebih aman konversi tiap sisi terpisah: "empat puluh lima sampai enam puluh")
const RE_RUPIAH = /\brp\.?\s*(\d{1,12}(?:\.\d{3})*(?:,\d+)?)/gi;
const RE_PERSEN = /(\d{1,3}(?:\.\d{3})*)\s*%/g;
const RE_DESIMAL = /(\d{1,9}),(\d{1,6})\b/g;
const RE_RIBUAN = /\b\d{1,3}(?:\.\d{3})+\b/g; // 1.000 / 175.500 (min satu titik grup 3 digit)
// Slang Indonesia: 150k / 150K / 150rb / 150RB = seratus lima puluh ribu
const RE_SLANG_RIBU = /\b(\d{1,9})\s*(k|rb)\b/gi;
const RE_BULAT = /\d{1,12}/g;

function bersihkanSpasiGanda(t: string): string {
  return t.replace(/[ \t]{2,}/g, " ").trim();
}

/**
 * Konversi SEMUA angka numerik dalam teks menjadi kata Bahasa Indonesia.
 * Aman dipanggil berulang (idempoten pada teks yang sudah bebas digit).
 */
export function angkaKeKata(text: string): string {
  let out = text ?? "";

  // 1. Rupiah: Rp175.000 → seratus tujuh puluh lima ribu rupiah
  out = out.replace(RE_RUPIAH, (_m, digits: string) => {
    const clean = digits.replace(/\./g, "");
    if (digits.includes(",")) {
      const [i, d] = digits.split(",");
      return `${desimalKeKata(Number(i.replace(/\./g, "")), d)} rupiah`;
    }
    return `${angkaBulatKeKata(Number(clean))} rupiah`;
  });

  // 2. Persen: 30% → tiga puluh persen
  out = out.replace(RE_PERSEN, (_m, digits: string) =>
    `${angkaBulatKeKata(Number(digits.replace(/\./g, "")))} persen`);

  // 3. Desimal koma: 3,5 → tiga koma lima
  out = out.replace(RE_DESIMAL, (_m, i: string, d: string) => desimalKeKata(Number(i), d));

  // 4. Ribuan bertitik: 1.000 → seribu (SEBELUM pola bulat polos)
  out = out.replace(RE_RIBUAN, (m: string) => angkaBulatKeKata(Number(m.replace(/\./g, ""))));

  // 4b. Slang ribu: 150k / 150rb → seratus lima puluh ribu
  out = out.replace(RE_SLANG_RIBU, (_m: string, digits: string) => `${angkaBulatKeKata(Number(digits))} ribu`);

  // 5. Bulat polos: 5 → lima, 2026 → dua ribu dua puluh enam
  out = out.replace(RE_BULAT, (m: string) => angkaBulatKeKata(Number(m)));

  return bersihkanSpasiGanda(out);
}

/** QC gate PRD §5: true kalau MASIH ada digit numerik tersisa di teks voiceover. */
export function adaAngkaTersisa(text: string): boolean {
  return /\d/.test(text ?? "");
}
