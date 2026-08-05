import { searchBrollVideo } from "@/lib/assets/broll";
import { STOCK_FOOTAGE_BUDGET_SECONDS } from "./clipSelect";

// Kombinasi footage asli + Pexels utk video (2026-08-05, permintaan Agus - "jika ada
// pembahasan wisata seperti danau beratan kebun raya bedugul dan lainnya gunakan
// pexels, jika menyangkut pelangi gunakan footage asli pelangi", rasio 7:3). BEDA dari
// deriveBrollKeywords.ts (itu 1 keyword umum utk suasana keseluruhan video, dipakai
// SEBELUM ada footage sama sekali) - modul ini SPESIFIK per landmark wisata yg
// disebut namanya di skrip, tiap landmark dapat klip Pexels-nya sendiri, ditempel
// mendampingi footage ASLI Pelangi (bukan menggantikan - footage asli tetap jadi
// dasar/mayoritas, lihat processProject.ts & renderFinalVideo).
//
// Daftar landmark + query Inggris HARDCODE (bukan diminta GPT nebak tiap kali) - sama
// pola dgn CLUSTER_PEXELS_QUERY di web-pelangi/backend/scripts/seo_agent.py, supaya
// hasil pencarian konsisten & bisa diaudit, bukan berubah-ubah tergantung mood GPT.
const DESTINATION_QUERIES: Record<string, string> = {
  "danau beratan": "ulun danu temple lake bali",
  "ulun danu": "ulun danu temple lake bali",
  "kebun raya": "bali botanical garden tropical",
  "handara": "handara gate bali iconic",
  "danau buyan": "bali highland lake mountain",
  "twin lake": "bali highland lake mountain",
  "pura ulun danu": "ulun danu temple lake bali",
  "pasar candi kuning": "bali traditional market highland",
  "candikuning": "bali traditional market highland",
  "bukit wanagiri": "bali mountain nature trail viewpoint",
  "air terjun": "bali waterfall tropical",
  "the blooms garden": "bali botanical garden tropical",
  "kebun stroberi": "strawberry farm highland",
  "kebun strawberry": "strawberry farm highland",
};

const CLIP_DURATION_CAP = 5; // detik - sama dgn MAX_CLIP_DURATION klip asli (clipSelect.ts), jaga pacing konsisten

// Cari landmark yg NAMANYA disebut literal di skrip (bukan klasifikasi umum/spesifik
// spt classifyIdea.ts) - urutan match mengikuti urutan definisi di atas, duplikat
// query yg sama (mis. "danau beratan" & "ulun danu") otomatis cuma dihitung sekali.
function detectDestinationMentions(script: string): string[] {
  const lower = script.toLowerCase();
  const seenQueries = new Set<string>();
  const queries: string[] = [];
  for (const [landmark, query] of Object.entries(DESTINATION_QUERIES)) {
    if (lower.includes(landmark) && !seenQueries.has(query)) {
      seenQueries.add(query);
      queries.push(query);
    }
  }
  return queries;
}

// Exposed ke processProject.ts (2026-08-05, permintaan Agus - "jika konten wisata
// dekat pelangi homestay pakai footage pexels 60% footage pelangi 40%") - dipakai utk
// PUTUSKAN rasio budget mana yg berlaku (lihat computeFootageBudgets di clipSelect.ts),
// bukan cuma jumlah query B-roll. "Konten wisata" = skrip MENYEBUT landmark spesifik,
// sama definisi persis dgn detectDestinationMentions di atas - satu sumber kebenaran.
export function isDestinationContent(script: string): boolean {
  return detectDestinationMentions(script).length > 0;
}

export type DestinationBrollClip = { videoUrl: string; durationSeconds: number };

// Ambil klip Pexels utk landmark wisata yg disebut skrip, SAMPAI budget durasi terisi
// (default STOCK_FOOTAGE_BUDGET_SECONDS = porsi 30% dari target 45 detik, lihat
// clipSelect.ts) ATAU landmark habis - bukan lagi jumlah klip tetap. Kalau landmark yg
// disebut cuma 1 tapi budget masih sisa, TIDAK diulang jadi >1 klip landmark yg sama
// (lebih baik video sedikit lebih pendek drpd 1 landmark diulang-ulang terasa
// repetitif). Skrip TANPA landmark spesifik -> array kosong, pemanggil
// (processProject.ts) yg putuskan fallback (brollKeywords umum spt sebelumnya).
export async function fetchDestinationBrollClips(
  script: string,
  budgetSeconds: number = STOCK_FOOTAGE_BUDGET_SECONDS,
  excludeUrls: Set<string> = new Set()
): Promise<DestinationBrollClip[]> {
  const queries = detectDestinationMentions(script);
  const clips: DestinationBrollClip[] = [];
  let usedSeconds = 0;

  for (const query of queries) {
    if (usedSeconds >= budgetSeconds) break;
    try {
      const broll = await searchBrollVideo(query, excludeUrls);
      if (broll) {
        const durationSeconds = Math.min(broll.durationSeconds, CLIP_DURATION_CAP);
        clips.push({ videoUrl: broll.videoUrl, durationSeconds });
        usedSeconds += durationSeconds;
      }
    } catch (err) {
      console.error(`[destinationBroll] gagal cari klip utk "${query}":`, err);
    }
  }
  return clips;
}
