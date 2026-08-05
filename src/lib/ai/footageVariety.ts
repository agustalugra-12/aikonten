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

// Batas ukuran footage yg BOLEH dipakai (2026-08-05, larangan Agus - "jangan pernah
// pakai 1 footage panjang", lihat processProject.ts) - dipindah ke sini (bukan private
// di processProject.ts lagi) krn auto-content/route.ts JUGA perlu tahu ini SEBELUM
// memilih klip room (bug nyata ditemukan lewat tes: klip room kepilih lolos seleksi tema
// tapi ternyata >24MB, jadi di-skip diam2 oleh guard di processProject.ts - room yg
// "dijamin" jadi TIDAK BENERAN ada di video final. Sekarang kedua tempat pakai fungsi
// SAMA, jadi yg dipilih di awal sudah pasti lolos guard di akhir).
export const MAX_FOOTAGE_BYTES = 24 * 1024 * 1024; // Whisper batas keras 25MB (26.214.400 byte) - margin aman

export async function getRemoteFileSizeBytes(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    const len = res.headers.get("content-length");
    return len ? parseInt(len, 10) : null;
  } catch {
    return null;
  }
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

// Komposisi WAJIB kamar vs halaman/lokasi properti (2026-08-05, permintaan Agus -
// "dalam pembuatan video wajib tampilkan video kamar sebanyak 60% dan halaman atau
// pelangi lokasi 40%") - BEDA dari isDestinationContent/DESTINATION_STOCK_RATIO
// (clipSelect.ts, itu rasio ASLI:PEXELS keseluruhan) - ini rasio DI DALAM porsi
// footage ASLI Pelangi itu sendiri, antara "kamar" vs "bukan kamar" (halaman, taman,
// gerbang, area umum, dst - semua yg BUKAN kamar dianggap "lokasi").
export const ROOM_FOOTAGE_RATIO = 0.6;

type FootageBankLike = { fileUrl: string; description: string | null; tags: string };

// Pilih klip ASLI dari bank dgn komposisi kamar:lokasi WAJIB 60:40 (bulat ke atas utk
// kamar), diutamakan dari `themedCandidates` (footage yg sudah dianggap relevan tema
// skrip oleh matchFootageForScript) - kalau kandidat tema tidak cukup memenuhi salah
// satu kategori, backfill dari `allBankVideos` (SELURUH bank, sama prinsip dgn jaminan
// room versi sebelumnya - kamar/lokasi selalu boleh dipakai terlepas cocok tema literal
// atau tidak, krn ini soal KOMPOSISI VISUAL wajib, bukan soal relevansi topik).
// `filterViableSize` (size guard) & freshness (anti-monoton) diterapkan di KEDUA
// tahap - kandidat yg lolos dari fungsi ini SUDAH pasti aman dipakai processProject.ts
// tanpa di-skip diam2 lagi (lihat bug room-shot sebelumnya, root cause SAMA).
export async function selectBalancedRealFootage(opts: {
  themedCandidates: FootageBankLike[];
  allBankVideos: FootageBankLike[];
  recentlyUsed: Set<string>;
  targetCount: number;
  filterViableSize: <T extends FootageBankLike>(items: T[]) => Promise<T[]>;
}): Promise<string[]> {
  const { themedCandidates, allBankVideos, recentlyUsed, targetCount, filterViableSize } = opts;
  const roomTarget = Math.ceil(targetCount * ROOM_FOOTAGE_RATIO);
  const locationTarget = targetCount - roomTarget;

  function split(items: FootageBankLike[]) {
    return {
      room: items.filter((r) => isRoomFootage(r.description, r.tags)),
      location: items.filter((r) => !isRoomFootage(r.description, r.tags)),
    };
  }

  function pickPreferringFresh(items: FootageBankLike[], count: number, exclude: Set<string>): FootageBankLike[] {
    const pool = items.filter((r) => !exclude.has(r.fileUrl));
    const fresh = pool.filter((r) => !recentlyUsed.has(r.fileUrl));
    const stale = pool.filter((r) => recentlyUsed.has(r.fileUrl));
    return [...fresh, ...stale].slice(0, count);
  }

  const themedViable = await filterViableSize(themedCandidates);
  const themedSplit = split(themedViable);

  const selected: FootageBankLike[] = [
    ...pickPreferringFresh(themedSplit.room, roomTarget, new Set()),
    ...pickPreferringFresh(themedSplit.location, locationTarget, new Set()),
  ];

  const haveUrls = new Set(selected.map((r) => r.fileUrl));
  const roomShortfall = roomTarget - selected.filter((r) => isRoomFootage(r.description, r.tags)).length;
  const locationShortfall = locationTarget - selected.filter((r) => !isRoomFootage(r.description, r.tags)).length;

  if (roomShortfall > 0 || locationShortfall > 0) {
    const bankViable = await filterViableSize(allBankVideos.filter((r) => !haveUrls.has(r.fileUrl)));
    const bankSplit = split(bankViable);
    if (roomShortfall > 0) selected.push(...pickPreferringFresh(bankSplit.room, roomShortfall, haveUrls));
    if (locationShortfall > 0) {
      const haveUrls2 = new Set(selected.map((r) => r.fileUrl));
      selected.push(...pickPreferringFresh(bankSplit.location, locationShortfall, haveUrls2));
    }
  }

  return selected.map((r) => r.fileUrl);
}
