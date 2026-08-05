import { db } from "@/db";
import { mediaAssets, projects } from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";

// Anti-monoton (2026-08-05, permintaan Agus - "footage jangan monoton, TikTok anggap
// konten berulang, ini penting sekali"). Lihat window N project video TERAKHIR brand
// ini (bukan SEMUA riwayat - footage lama boleh dipakai ulang lagi nanti, cuma jangan
// balik-balik langsung di video yg berdekatan) - kumpulkan fileUrl yg sudah kepakai,
// baik footage asli (raw_footage) MAUPUN klip Pexels/Pixabay (broll_used, lihat
// processProject.ts) - dipakai auto-content/route.ts (footage asli) & processProject.ts
// (broll) utk MENGHINDARI url yg sama terpilih lagi.
const RECENT_PROJECTS_WINDOW = 5;

export async function getRecentlyUsedFootageUrls(brandId: string): Promise<Set<string>> {
  const recentProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.brandId, brandId), eq(projects.type, "video")))
    .orderBy(desc(projects.createdAt))
    .limit(RECENT_PROJECTS_WINDOW);
  if (recentProjects.length === 0) return new Set();

  const ids = recentProjects.map((p) => p.id);
  const assets = await db
    .select({ type: mediaAssets.type, fileUrl: mediaAssets.fileUrl })
    .from(mediaAssets)
    .where(inArray(mediaAssets.projectId, ids));

  return new Set(
    assets.filter((a) => a.type === "raw_footage" || a.type === "broll_used").map((a) => a.fileUrl)
  );
}

const ROOM_REGEX = /\bkamar\b|\broom\b/i;

// Deteksi footage "kamar" (2026-08-05, permintaan Agus - "aku mau di setiap pembuatan
// video ada menampilkan room Pelangi dari footage") - regex sederhana atas
// description+tags yg SUDAH di-generate AI sekali pas upload ke Bank Footage
// (describeFootage.ts), bukan panggilan AI baru.
export function isRoomFootage(description: string | null, tagsJson: string): boolean {
  if (description && ROOM_REGEX.test(description)) return true;
  try {
    const tags: string[] = JSON.parse(tagsJson);
    return tags.some((t) => ROOM_REGEX.test(t));
  } catch {
    return false;
  }
}
