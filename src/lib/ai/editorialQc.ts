// Gerbang QC editorial (P3 HyperFrames Pro, 2026-11-03). Preflight MURAH (tanpa vision) yg
// dijalankan SEBELUM render: menangkap cacat editorial yg pernah terjadi (hook kamar mandi,
// caption angka-garbage "00 00") supaya tak pernah lolos ke draf. P1 (director) + filter
// caption sudah MENCEGAH; ini JARING PENGAMAN yg memverifikasi pencegahan bekerja + tangkap
// edge-case. severity "reject" -> render ditolak/retry; "warn" -> dicatat, tak menolak.

export type EditorialIssue = { code: string; severity: "reject" | "warn"; message: string };

const AVOID_HOOK = ["kamar mandi", "toilet", "wc", "kloset", "wastafel", "westafel", "shower", "bathroom", "closet"];

export function editorialPreflight(opts: {
  hasFootage: boolean;
  heroTags?: string[];                    // tag klip footage PERTAMA (penentu hook)
  captionWords?: Array<{ word: string }>; // wordTimings caption
  hookText?: string | null;
}): EditorialIssue[] {
  const issues: EditorialIssue[] = [];

  // 1. Hero shot bukan kamar mandi (double-check P1 director).
  if (opts.heroTags && opts.heroTags.length) {
    const t = opts.heroTags.map((x) => String(x).toLowerCase());
    if (t.some((tag) => AVOID_HOOK.some((a) => tag.includes(a)))) {
      issues.push({ code: "hook_bathroom", severity: "reject", message: "Footage hook = kamar mandi/toilet (buruk untuk pembuka)" });
    }
  }

  // 2. Caption tak boleh ada token MURNI angka (Whisper digitalkan ulang -> "00 00").
  const garbage = (opts.captionWords || []).filter((w) => /^[\d.,]+$/.test(String(w.word || "").trim()));
  if (garbage.length > 0) {
    issues.push({ code: "caption_number_garbage", severity: "reject", message: `Caption ada ${garbage.length} token angka mentah (mis "${garbage[0].word}")` });
  }

  // 3. Peringatan lunak.
  if (!opts.hasFootage) issues.push({ code: "no_footage", severity: "warn", message: "Tanpa footage (desain-only / faceless)" });
  if (!opts.hookText || !String(opts.hookText).trim()) issues.push({ code: "no_hook", severity: "warn", message: "Tak ada hook text" });

  return issues;
}

// Benar kalau ada isu "reject" (render harus ditahan/retry).
export function hasRejectIssue(issues: EditorialIssue[]): boolean {
  return issues.some((i) => i.severity === "reject");
}

// Self-check.
export function _demo(): void {
  const ok = editorialPreflight({ hasFootage: true, heroTags: ["kamar tidur", "ranjang"], captionWords: [{ word: "nyaman" }, { word: "sejuk" }], hookText: "Liburan sejuk di Bedugul" });
  if (hasRejectIssue(ok)) throw new Error("harusnya lolos: " + JSON.stringify(ok));
  const bad = editorialPreflight({ hasFootage: true, heroTags: ["kamar mandi", "toilet"], captionWords: [{ word: "00" }], hookText: "x" });
  if (!bad.some((i) => i.code === "hook_bathroom") || !bad.some((i) => i.code === "caption_number_garbage")) {
    throw new Error("harusnya tangkap 2 reject: " + JSON.stringify(bad));
  }
}
