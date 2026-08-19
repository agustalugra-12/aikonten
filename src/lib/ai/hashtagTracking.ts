import { db } from "@/db";
import { projects } from "@/db/schema";
import { and, eq, desc, isNotNull, gte } from "drizzle-orm";

// Hashtag Repetition Tracking (PRD §42) - hindari penggunaan set hashtag yang
// sama terus-menerus. Query hashtag dari project terakhir (window 20 project),
// hitung frekuensi, kembalikan hashtag yang overused utk dihindari di generate
// berikutnya.

const RECENT_PROJECTS_WINDOW = 20;
const OVERUSED_THRESHOLD = 3; // hashtag yg dipakai >=3x di 20 project terakhir = overused

export type HashtagUsage = {
  hashtag: string;
  count: number;
};

export async function getOverusedHashtags(brandId: string): Promise<string[]> {
  const recent = await db
    .select({ hashtags: projects.generatedHashtags })
    .from(projects)
    .where(
      and(
        eq(projects.brandId, brandId),
        isNotNull(projects.generatedHashtags),
      )
    )
    .orderBy(desc(projects.createdAt))
    .limit(RECENT_PROJECTS_WINDOW);

  const freq: Record<string, number> = {};
  for (const row of recent) {
    if (!row.hashtags) continue;
    try {
      const tags: string[] = JSON.parse(row.hashtags);
      for (const tag of tags) {
        const normalized = tag.toLowerCase().replace(/^#+/, "");
        freq[normalized] = (freq[normalized] || 0) + 1;
      }
    } catch {
      continue;
    }
  }

  return Object.entries(freq)
    .filter(([, count]) => count >= OVERUSED_THRESHOLD)
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);
}

export function buildHashtagAvoidancePrompt(overused: string[]): string {
  if (overused.length === 0) return "";
  const list = overused.join(", ");
  return "\n\nIMPORTANT: The following hashtags have been used TOO FREQUENTLY recently and MUST be AVOIDED: " + list + ". Generate DIFFERENT, fresh hashtags that haven't been used recently.";
}
