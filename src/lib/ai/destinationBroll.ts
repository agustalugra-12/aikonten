import { searchBrollVideo } from "@/lib/assets/broll";

// Kombinasi footage asli + Pexels utk video (2026-08-05, permintaan Agus - "jika ada
// pembahasan wisata seperti danau beratan kebun raya bedugul dan lainnya gunakan
// pexels, jika menyangkut pelangi gunakan footage asli pelangi"). BEDA dari
// deriveBrollKeywords.ts (itu 1 keyword umum utk suasana keseluruhan video, dipakai
// SEBELUM ada footage sama sekali) - modul ini SPESIFIK per landmark wisata yg
// disebut namanya di skrip, tiap landmark dapat klip Pexels-nya sendiri, ditempel
// mendampingi footage ASLI Pelangi (bukan menggantikan - footage asli tetap jadi
// dasar/klip pertama, lihat processProject.ts & renderFinalVideo).
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

const MAX_DESTINATION_CLIPS = 2;
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

export type DestinationBrollClip = { videoUrl: string; durationSeconds: number };

// Ambil klip Pexels utk tiap landmark wisata yg disebut di skrip (maks
// MAX_DESTINATION_CLIPS, biar video tetap ritme pendek/reels). Kalau skrip TIDAK
// menyebut landmark manapun, balas array kosong - pemanggil (processProject.ts) yg
// putuskan fallback (mis. tetap pakai brollKeywords umum spt sebelumnya).
export async function fetchDestinationBrollClips(script: string): Promise<DestinationBrollClip[]> {
  const queries = detectDestinationMentions(script).slice(0, MAX_DESTINATION_CLIPS);
  const clips: DestinationBrollClip[] = [];
  for (const query of queries) {
    try {
      const broll = await searchBrollVideo(query);
      if (broll) {
        clips.push({ videoUrl: broll.videoUrl, durationSeconds: Math.min(broll.durationSeconds, CLIP_DURATION_CAP) });
      }
    } catch (err) {
      console.error(`[destinationBroll] gagal cari klip utk "${query}":`, err);
    }
  }
  return clips;
}
