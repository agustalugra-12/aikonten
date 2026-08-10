// Comparison Bar (2026-08-10, "Overlay System PRD" Category A - "Human Comparison",
// "Weight comparison") - REUSE stat yg SUDAH diekstrak statExtractor.ts (BUKAN
// panggilan GPT baru, nol biaya tambahan) - HANYA jalan kalau statnya berkategori
// "weight" DAN nilainya bisa di-parse ke satuan berat yg dikenal (kg/ton/g/lbs).
// Kalau tidak bisa di-parse (satuan aneh/tidak disebut angka jelas), TIDAK ADA
// comparison bar ditampilkan sama sekali - drpd nekat nampilin bar yg salah skala.
// Referensi "Average Human ~70kg" - fakta umum independen (BUKAN klaim ttg subjek
// video), dipakai HANYA sbg pembanding visual, bukan sumber fakta baru ttg hewan itu.
const HUMAN_REFERENCE_KG = 70;
const FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

export function parseWeightToKg(value: string): number | null {
  const m = value.match(/([\d,.]+)\s*(kilograms?|kg|tonnes?|tons?|t\b|grams?|g\b|pounds?|lbs?)/i);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(num)) return null;
  const unit = m[2].toLowerCase();
  if (unit.startsWith("kilogram") || unit === "kg") return num;
  if (unit.startsWith("ton") || unit === "t") return num * 1000;
  if (unit.startsWith("gram") || unit === "g") return num / 1000;
  if (unit.startsWith("pound") || unit.startsWith("lb")) return num * 0.4536;
  return null;
}

// Skala bar VISUAL saja (sqrt, di-cap) - BUKAN klaim rasio matematis presisi, teks
// angka asli tetap ditampilkan apa adanya sbg sumber kebenaran, bar cuma bantu kesan
// "jauh lebih besar/kecil" scr sekilas (spt infografis dokumenter umumnya).
function visualBarWidthRatio(subjectKg: number): number {
  const raw = Math.sqrt(subjectKg / HUMAN_REFERENCE_KG);
  return Math.max(0.15, Math.min(5, raw)); // cap 5x (2026-08-10, diturunkan dari 8 - visual lebih seimbang, tetap kasih kesan "jauh lebih besar" tanpa bar sampai nutupin frame)
}

export function buildComparisonBarFilter(
  subjectLabel: string,
  subjectValueText: string,
  subjectKg: number,
  startSeconds: number,
  targetWidth: number,
  targetHeight: number
): string {
  const displaySeconds = 2.2;
  const fadeSeconds = 0.3;
  const endSeconds = startSeconds + displaySeconds;
  const fadeOutStart = endSeconds - fadeSeconds;
  const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "").replace(/:/g, "\\:");

  const baseY = Math.round(targetHeight * 0.3);
  const barH = Math.round(targetHeight * 0.028);
  const gap = Math.round(barH * 1.8);
  const leftX = Math.round(targetWidth * 0.08);
  const humanBarW = Math.round(targetWidth * 0.18);
  const subjectBarW = Math.min(Math.round(targetWidth * 0.8), Math.round(humanBarW * visualBarWidthRatio(subjectKg)));
  const fontSize = Math.round(targetWidth * 0.034);

  const alphaExpr =
    `if(lt(t,${startSeconds.toFixed(2)}),0,if(lt(t,${(startSeconds + fadeSeconds).toFixed(2)}),` +
    `(t-${startSeconds.toFixed(2)})/${fadeSeconds},if(lt(t,${fadeOutStart.toFixed(2)}),1,` +
    `if(lt(t,${endSeconds.toFixed(2)}),(${endSeconds.toFixed(2)}-t)/${fadeSeconds},0))))`;
  const enableExpr = `between(t,${startSeconds.toFixed(2)},${endSeconds.toFixed(2)})`;

  return [
    `drawbox=x=${leftX}:y=${baseY}:w=${subjectBarW}:h=${barH}:color=#E8B84B@0.9:t=fill:enable='${enableExpr}'`,
    // BUG NYATA ditemukan lewat render sungguhan (2026-08-10) - escape() dipanggil
    // TERPISAH per potongan dgn ": " literal MENTAH di antaranya sblm fix ini -
    // titik-dua MENTAH itu bikin drawtext berhenti baca "text=" di situ (sama kelas
    // bug dgn apostrof CTA sebelumnya), value-nya HILANG dari layar. Fix: escape()
    // SATU STRING GABUNGAN (sama pola yg SUDAH benar di baris "Average Human" bawah).
    `drawtext=fontfile=${FONT_PATH}:text='${escape(`${subjectLabel}: ${subjectValueText}`)}':fontsize=${fontSize}:` +
      `fontcolor=white:x=${leftX}:y=${baseY - Math.round(fontSize * 1.15)}:alpha='${alphaExpr}'`,
    `drawbox=x=${leftX}:y=${baseY + gap}:w=${humanBarW}:h=${barH}:color=#4B9AE8@0.9:t=fill:enable='${enableExpr}'`,
    `drawtext=fontfile=${FONT_PATH}:text='${escape(`Average Human: ~${HUMAN_REFERENCE_KG}kg`)}':fontsize=${fontSize}:` +
      `fontcolor=white:x=${leftX}:y=${baseY + gap - Math.round(fontSize * 1.15)}:alpha='${alphaExpr}'`,
  ].join(",");
}
