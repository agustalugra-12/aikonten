import { getOpenAIClient } from "@/lib/ai/openaiClient";
import { analyzeInspiration, type InspirationPrinciples } from "./inspirationAnalyzer";

// Creator Benchmark (PRD Agustap Studio Content Intelligence §2.1.A, §2.9-2.13,
// 2026-09-01). REUSE penuh Inspiration Analyzer (Phase 2, inspirationAnalyzer.ts)
// sebagai unit kerja per-konten - modul ini HANYA menambah: (1) analisis BANYAK
// konten sekaligus, (2) agregasi jadi 1 profile ringkas, (3) fallback account-level
// acquisition (§2.12: "Jangan membuat scraper agresif sebagai dependency wajib" -
// jadi best-effort SANGAT minimal, bukan headless browser/API resmi platform).
//
// Persistence (profile tersimpan, Active/Inactive) BUKAN tanggung jawab modul ini -
// caller (route/handler) yang simpan hasil ke tabel `competitors` (kolom
// account_url/benchmark_profile/role/benchmark_active/analyzed_content_count,
// lihat migrasi 0041 & docs/REUSE_MAP.md) - pola sama dgn inspirationAnalyzer.ts/
// contentTransformer.ts yang juga tidak menyentuh DB sendiri.

export type CreatorBenchmarkProfile = {
  hookPattern: string;
  storytellingPattern: string;
  contentAngle: string;
  pacing: string;
  ctaPattern: string;
  visualPattern: string;
  audiencePattern: string;
};

export type CreatorBenchmarkResult =
  | { ok: true; profile: CreatorBenchmarkProfile; analyzedContentCount: number }
  | { ok: false; error: "NO_CONTENT_ANALYZED"; detail: string };

const MAX_ACCOUNT_LINKS = 20;
const ACCOUNT_FETCH_TIMEOUT_MS = 10_000;

/**
 * §2.12: coba temukan beberapa link konten dari halaman akun - best-effort SANGAT
 * minimal (parse <a href> dari HTML statis), BUKAN scraper agresif/headless
 * browser/API resmi platform (PRD eksplisit melarang itu jadi dependency wajib).
 * Realistis: mayoritas akun platform short-form video (TikTok/Instagram/YouTube)
 * JS-rendered - fungsi ini akan sering return array kosong, itu SINYAL yang benar
 * (§2.12 "Unavailable" -> user masukkan Content URL manual), bukan bug.
 */
export async function tryDiscoverContentUrlsFromAccount(
  accountUrl: string,
  max: number = MAX_ACCOUNT_LINKS
): Promise<string[]> {
  let base: URL;
  try {
    base = new URL(accountUrl);
  } catch {
    return [];
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACCOUNT_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(base.toString(), {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; KontenPilotBot/1.0)" },
    });
    if (!res.ok) return [];
    const html = await res.text();
    const hrefs = new Set<string>();
    const re = /href=["']([^"'#]+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && hrefs.size < max) {
      try {
        const resolved = new URL(m[1], base).toString();
        // Heuristik longgar: link ke domain sama, beda path dari akun itu sendiri
        // (bukan link navigasi/menu situs yang jelas bukan konten individual).
        const resolvedUrl = new URL(resolved);
        if (resolvedUrl.hostname === base.hostname && resolved !== base.toString()) {
          hrefs.add(resolved);
        }
      } catch {
        continue;
      }
    }
    return Array.from(hrefs).slice(0, max);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * §2.1.A / §2.11: analisis BANYAK konten (idealnya 10-20, tapi jalan dgn jumlah
 * berapa pun >=1 yang berhasil dianalisis - PRD tidak minta gagalkan semua kalau
 * sebagian link mati) lalu agregasi jadi 1 Creator Benchmark Profile. Setiap
 * konten dianalisis via `analyzeInspiration` (REUSE Phase 2 - bukan reimplementasi
 * fetch/LLM-extract-principle).
 */
export async function buildCreatorBenchmarkFromContentUrls(
  contentUrls: string[],
  creatorName: string
): Promise<CreatorBenchmarkResult> {
  const analyses = await Promise.all(
    contentUrls.map((url) => analyzeInspiration({ referenceUrl: url, creatorName }))
  );
  const succeeded = analyses.filter(
    (a): a is { ok: true; principles: InspirationPrinciples; sourceUsed: "url" | "transcript" | "summary" | "screenshot" } =>
      a.ok
  );
  if (succeeded.length === 0) {
    return {
      ok: false,
      error: "NO_CONTENT_ANALYZED",
      detail:
        `Tidak ada satu pun dari ${contentUrls.length} link yang berhasil dianalisis ` +
        "(semua SOURCE_UNAVAILABLE) - creator benchmark tidak bisa dibuat dari sumber ini.",
    };
  }

  const client = getOpenAIClient();
  const perContentSummary = succeeded
    .map(
      (a, i) =>
        `### Konten ${i + 1}\nHook: ${a.principles.hookPattern}\nAngle: ${a.principles.angle}\n` +
        `Storytelling: ${a.principles.storytellingStructure}\nPacing: ${a.principles.pacing}\n` +
        `CTA: ${a.principles.ctaPattern}\nPsychology: ${a.principles.psychology}`
    )
    .join("\n\n");

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content:
          `Kamu analis pola konten. Dari ${succeeded.length} analisis konten creator ` +
          `"${creatorName}" di bawah, cari POLA YANG BERULANG/KONSISTEN (bukan sekadar ` +
          "mengulang satu konten) - ini jadi Creator Benchmark Profile yang dipakai " +
          "berulang kali sbg background intelligence (PRD §2.1.A/§2.4), BUKAN ringkasan " +
          "satu konten. Kalau kontennya cuma 1, deskripsikan pola dari konten itu apa " +
          "adanya (belum bisa disebut 'konsisten', tapi tetap actionable).",
      },
      {
        role: "user",
        content:
          `${perContentSummary}\n\nBalas HARUS JSON valid (tanpa markdown code fence): ` +
          `{"hookPattern": "...", "storytellingPattern": "...", "contentAngle": "...", ` +
          `"pacing": "...", "ctaPattern": "...", "visualPattern": "...", "audiencePattern": "..."}`,
      },
    ],
    temperature: 0.4,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "{}";
  const cleaned = raw.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  try {
    const parsed = JSON.parse(cleaned);
    const profile: CreatorBenchmarkProfile = {
      hookPattern: str(parsed.hookPattern),
      storytellingPattern: str(parsed.storytellingPattern),
      contentAngle: str(parsed.contentAngle),
      pacing: str(parsed.pacing),
      ctaPattern: str(parsed.ctaPattern),
      visualPattern: str(parsed.visualPattern),
      audiencePattern: str(parsed.audiencePattern),
    };
    return { ok: true, profile, analyzedContentCount: succeeded.length };
  } catch {
    return {
      ok: false,
      error: "NO_CONTENT_ANALYZED",
      detail: "AI gagal mengagregasi profile dari hasil analisis - coba lagi.",
    };
  }
}

// V1 seed list (PRD §2.9) - HANYA data awal yang ditawarkan di UI "+ Add Creator",
// BUKAN daftar tertutup (user bisa tambah/nonaktifkan/hapus bebas, §2.9 "Tanpa
// perubahan pada core AI KontenPilot"). Role per §2.10.
export const CREATOR_BENCHMARK_V1_SEED: { name: string; role: string }[] = [
  { name: "Victoria Wong", role: "storytelling / content / social media" },
  { name: "Alex Hormozi", role: "hook / attention / problem framing" },
  { name: "Justin Welsh", role: "simplification / business content" },
  { name: "Neil Patel", role: "marketing education" },
  { name: "Vanessa Lau", role: "creator strategy" },
  { name: "Seth Godin", role: "positioning / marketing psychology" },
];
