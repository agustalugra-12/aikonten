// Script Structure Library — 25 pola storytelling untuk AI Konten (PRD v1.1 §1, 2026-08-22)
// AI memilih struktur berdasarkan intent topik, bukan random. Rotasi dinamis via contentVariety.ts.
// Kombinasi diizinkan (mis. Curiosity + Story = hook misterius + cerita + reveal + insight).

export type ScriptStructure = {
  id: string;
  nama: string;
  alur: string; // guide untuk prompt AI (Bahasa Indonesia)
  intents: string[]; // keyword intent yang cocok
};

export const SCRIPT_STRUCTURES: ScriptStructure[] = [
  // === Edukasi / Fakta / Tutorial ===
  {
    id: "step_by_step",
    nama: "Step by Step",
    alur: "Masalah → Langkah 1 → Langkah 2 → Langkah 3 → Hasil",
    intents: ["tutorial", "how_to", "cara", "langkah", "panduan", "prosedur"],
  },
  {
    id: "three_reasons",
    nama: "Three Reasons",
    alur: "Hook → Alasan pertama → Alasan kedua → Alasan ketiga → Kesimpulan",
    intents: ["alasan", "kenapa", "mengapa", "3 alasan", "tiga alasan", "alasan utama"],
  },
  {
    id: "curiosity",
    nama: "Curiosity",
    alur: "Hook misterius → Clue → Penjelasan → Reveal",
    intents: ["penasaran", "rahasia", "kenapa", "misteri", "curiosity", "enggano", "ingin tahu"],
  },
  {
    id: "myth_fact",
    nama: "Myth → Fact",
    alur: "Mitos → Bantahan → Fakta → Penjelasan",
    intents: ["mitos", "fakta", "salah paham", "kesalahpahaman", "benar salah", "myth", "fact"],
  },
  {
    id: "fast_facts",
    nama: "Fast Facts",
    alur: "Hook → Fakta 1 → Fakta 2 → Fakta 3 → Insight",
    intents: ["fakta", "fakta cepat", "cepat", "ringkas", "facts", "trivia", "mengetahui"],
  },
  {
    id: "question_answer",
    nama: "Question → Answer",
    alur: "Pertanyaan → Bangun curiosity → Jawaban → Penjelasan",
    intents: ["pertanyaan", "tanya", "jawab", "qna", "tanya jawab", "how", "what", "why"],
  },

  // === Problem Solving / Tips / UMKM ===
  {
    id: "problem_solution",
    nama: "Problem → Solution",
    alur: "Masalah → Penyebab → Solusi → CTA",
    intents: ["masalah", "solusi", "cara mengatasi", "solve", "tips", "trik", "tips umkm", "tips bisnis"],
  },
  {
    id: "mistake",
    nama: "Mistake",
    alur: "Kesalahan → Dampak → Cara memperbaiki",
    intents: ["kesalahan", "salah", "jangan", "hindari", "error", "mistake", "kesalahan umum"],
  },
  {
    id: "before_after",
    nama: "Before → After",
    alur: "Kondisi awal → Perubahan → Cara → Hasil",
    intents: ["sebelum sesudah", "transformasi", "perubahan", "hasil", "before after", "perbaikan"],
  },
  {
    id: "do_vs_dont",
    nama: "Do vs Don't",
    alur: "Yang benar → Yang salah → Perbandingan → Tips",
    intents: ["boleh tidak boleh", "harus tidak", "benar salah", "tips aman", "etika"],
  },

  // === Story / Emotional / Personal ===
  {
    id: "story",
    nama: "Story",
    alur: "Situasi → Masalah → Konflik → Penyelesaian → Insight",
    intents: ["cerita", "pengalaman", "kisah", "story", "kisah nyata", "inspiratif", "motivasi"],
  },
  {
    id: "case_study",
    nama: "Case Study",
    alur: "Kondisi → Tindakan → Hasil → Pelajaran",
    intents: ["case study", "studi kasus", "contoh nyata", "pelajaran", "analisis"],
  },
  {
    id: "story_lesson",
    nama: "Story + Lesson",
    alur: "Cerita singkat → Twist → Pelajaran",
    intents: ["pelajaran hidup", "hikmah", "refleksi", "lesson learned", "hikmat"],
  },
  {
    id: "observation",
    nama: "Observation",
    alur: "Hal yang terlihat → Fakta menarik → Makna → Kesimpulan",
    intents: ["observasi", "pengamatan", "fenomena", "hal menarik", "awareness"],
  },
  {
    id: "reaction_insight",
    nama: "Reaction / Insight",
    alur: "Fenomena → Reaksi → Analisis → Pelajaran",
    intents: ["reaksi", "tanggapan", "analisis", "insight", "pendapat", "opini", "kritik"],
  },
  {
    id: "timeline",
    nama: "Timeline",
    alur: "Dulu → Perubahan → Sekarang → Pelajaran",
    intents: ["sejarah", "perkembangan", "timeline", "dulu sekarang", "evolusi", "riwayat"],
  },

  // === Comparison / Decision ===
  {
    id: "comparison",
    nama: "Comparison",
    alur: "A vs B → Perbedaan → Mana yang lebih baik → Alasan",
    intents: ["perbandingan", "versus", "vs", "mana lebih baik", "pilih mana", "banding", "review"],
  },
  {
    id: "contrarian",
    nama: "Contrarian",
    alur: "Pendapat umum → 'Sebenarnya...' → Bukti → Kesimpulan",
    intents: ["berlawanan", "kontroversial", "sebenarnya", "mitos", "kontra", "unpopular opinion"],
  },
  {
    id: "ranking",
    nama: "Ranking",
    alur: "Hook → Ranking → Alasan → Pemenang",
    intents: ["ranking", "peringkat", "top", "terbaik", "pemenang", "leaderboard"],
  },

  // === Creative / Engagement ===
  {
    id: "scenario",
    nama: "Scenario",
    alur: "'Bayangkan kalau...' → Situasi → Solusi → Hasil",
    intents: ["bayangkan", "skenario", "kalau", "what if", "simulasi", "skenario"],
  },
  {
    id: "open_loop",
    nama: "Open Loop",
    alur: "Hook → Informasi sebagian → Build-up → Jawaban",
    intents: ["teaser", "cliffhanger", "lanjut", "lanjutan", "curiosity gap", "tetap nonton"],
  },
  {
    id: "checklist",
    nama: "Checklist",
    alur: "Hook → Hal yang harus dicek → Penjelasan → Kesimpulan",
    intents: ["checklist", "daftar", "persiapan", "persyaratan", "syarat", "poin cek"],
  },
  {
    id: "challenge",
    nama: "Challenge",
    alur: "Tantangan → Proses → Hasil → Insight",
    intents: ["tantangan", "challenge", "coba", "ujian", "eksperimen", "test"],
  },
  {
    id: "secret_tip",
    nama: "Secret / Hidden Tip",
    alur: "Hook → 'Banyak orang tidak tahu...' → Insight → Penjelasan",
    intents: ["rahasia", "tip tersembunyi", "tidak banyak yang tahu", "insider", "pro tip"],
  },
];

// === Intent Detection (deterministic keyword-based, no LLM needed) ===
export function detectIntent(topic: string, contentPillar?: string): string[] {
  const text = `${topic} ${contentPillar ?? ""}`.toLowerCase();
  const matched: string[] = [];

  const INTENT_KEYWORDS: Record<string, string[]> = {
    step_by_step: ["cara", "langkah", "tutorial", "panduan", "prosedur", "how to", "step by step"],
    three_reasons: ["3 alasan", "tiga alasan", "alasan", "kenapa", "mengapa", "alasan utama"],
    curiosity: ["penasaran", "rahasia", "misteri", "kenapa", "ingin tahu", "curiosity", "enggano"],
    myth_fact: ["mitos", "fakta", "salah paham", "kesalahpahaman", "benar salah", "myth", "fact"],
    fast_facts: ["fakta cepat", "cepat", "ringkas", "facts", "trivia", "mengetahui", "fakta menarik"],
    question_answer: ["pertanyaan", "tanya", "jawab", "qna", "tanya jawab", "bagaimana", "apa", "mengapa"],
    problem_solution: ["masalah", "solusi", "cara mengatasi", "tips", "trik", "solve", "tips umkm", "tips bisnis"],
    mistake: ["kesalahan", "salah", "jangan", "hindari", "error", "mistake", "kesalahan umum"],
    before_after: ["sebelum sesudah", "transformasi", "perubahan", "hasil", "before after", "perbaikan"],
    do_vs_dont: ["boleh tidak boleh", "harus tidak", "benar salah", "tips aman", "etika", "do don't"],
    story: ["cerita", "pengalaman", "kisah", "story", "kisah nyata", "inspiratif", "motivasi"],
    case_study: ["case study", "studi kasus", "contoh nyata", "pelajaran", "analisis"],
    story_lesson: ["pelajaran hidup", "hikmah", "refleksi", "lesson learned", "hikmat"],
    observation: ["observasi", "pengamatan", "fenomena", "hal menarik", "awareness"],
    reaction_insight: ["reaksi", "tanggapan", "analisis", "insight", "pendapat", "opini", "kritik"],
    timeline: ["sejarah", "perkembangan", "timeline", "dulu sekarang", "evolusi", "riwayat"],
    comparison: ["perbandingan", "versus", "vs", "mana lebih baik", "pilih mana", "banding", "review"],
    contrarian: ["berlawanan", "kontroversial", "sebenarnya", "mitos", "kontra", "unpopular opinion"],
    ranking: ["ranking", "peringkat", "top", "terbaik", "pemenang", "leaderboard"],
    scenario: ["bayangkan", "skenario", "kalau", "what if", "simulasi", "skenario"],
    open_loop: ["teaser", "cliffhanger", "lanjut", "lanjutan", "curiosity gap", "tetap nonton"],
    checklist: ["checklist", "daftar", "persiapan", "persyaratan", "syarat", "poin cek"],
    challenge: ["tantangan", "challenge", "coba", "ujian", "eksperimen", "test"],
    secret_tip: ["rahasia", "tip tersembunyi", "tidak banyak yang tahu", "insider", "pro tip"],
  };

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    if (keywords.some((k) => text.includes(k))) {
      matched.push(intent);
    }
  }

  // Default fallback
  if (matched.length === 0) {
    matched.push("problem_solution");
  }

  // Dedup
  return [...new Set(matched)];
}

// === Structure Selection (uses contentVariety.ts style weighted LRU) ===
export function selectStructure(intents: string[], overusedStructures: string[] = []): ScriptStructure {
  // Score each structure by intent match count
  const scored = SCRIPT_STRUCTURES.map((s) => ({
    structure: s,
    score: s.intents.filter((i) => intents.includes(i)).length,
  }));

  // Filter out overused
  const candidates = scored
    .filter((s) => s.score > 0 && !overusedStructures.includes(s.structure.id))
    .sort((a, b) => b.score - a.score || Math.random() - 0.5);

  // If all scored 0 or all overused, pick least-used from all (weighted LRU style)
  const fallback = SCRIPT_STRUCTURES.filter(
    (s) => !overusedStructures.includes(s.id)
  ).sort(() => Math.random() - 0.5);

  const picked = candidates[0]?.structure ?? fallback[0] ?? SCRIPT_STRUCTURES[0];
  return picked;
}

// === Combo Support (merge two structures naturally) ===
export function maybeCombineStructures(primary: ScriptStructure, secondary?: ScriptStructure): string {
  if (!secondary || primary.id === secondary.id) return primary.alur;

  // Combo rules per PRD
  const combos: Record<string, string> = {
    "curiosity+story": "Hook misterius → Cerita → Masalah → Reveal → Insight",
    "problem+before_after": "Masalah → Kondisi buruk → Perubahan → Hasil → Cara",
    "curiosity+three_reasons": "Hook misterius → Alasan 1 → Alasan 2 → Alasan 3 → Reveal",
    "story+lesson": "Cerita singkat → Twist → Pelajaran",
    "problem+solution": "Masalah → Penyebab → Solusi → CTA",
  };

  const key1 = `${primary.id}+${secondary.id}`;
  const key2 = `${secondary.id}+${primary.id}`;
  if (combos[key1]) return combos[key1];
  if (combos[key2]) return combos[key2];

  // Default: append secondary alur as "tambahan"
  return `${primary.alur} | Tambahan: ${secondary.alur}`;
}
