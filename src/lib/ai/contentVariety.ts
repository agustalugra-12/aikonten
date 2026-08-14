import { db } from "@/db";
import { projects } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";

// Anti-monoton utk struktur video & tipe hook (2026-08-14, PRD "AI Content
// Intelligence" Fase 1, permintaan Agus - lihat spec doc utk detail lengkap). Window
// LEBIH KECIL drpd contentSimilarity.ts (20) & LEBIH BESAR drpd footageVariety.ts (5):
// pool structureTemplate/hookType cuma py 5-11 nilai mungkin (jauh lebih sedikit drpd
// ratusan footage asset ATAU teks caption bebas) - window 20 bikin threshold "lebih
// dari Nx" jadi tidak berarti (hampir semua nilai akan muncul >Nx murni dari rotasi
// merata di window sebesar itu), sementara window 5 terlalu mepet (brand dgn
// pillar/topik terbatas WAJAR mengulang struktur dlm 5 post tanpa itu benar2 monoton).
const RECENT_PROJECTS_WINDOW = 8;

// Threshold deteksi pengulangan (2026-08-14) - dipilih supaya kira2 sebanding dgn
// ukuran pool masing2 (2/7 struktur pendek ~29%, 3/11 hook ~27% - flag SEBELUM suatu
// pola jadi dominan di window, bukan sesudah). Lihat spec doc utk pertimbangan lengkap.
const STRUCTURE_REPEAT_THRESHOLD = 2;
const HOOK_REPEAT_THRESHOLD = 3;

export type StructureHookUsage = {
  structureCounts: Map<string, number>;
  hookTypeCounts: Map<string, number>;
};

// Fungsi MURNI (2026-08-14) - dipisah dari query DB supaya bisa di-unit-test tanpa DB
// sama sekali (pola sama dgn ai-chat-bot's "ekstrak guard jadi fungsi murni", CLAUDE.md
// repo itu - prinsip yg sama walau repo/stack beda).
export function tallyStructureAndHookUsage(
  rows: { structureTemplate: string | null; hookType: string | null }[]
): StructureHookUsage {
  const structureCounts = new Map<string, number>();
  const hookTypeCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.structureTemplate) {
      structureCounts.set(r.structureTemplate, (structureCounts.get(r.structureTemplate) || 0) + 1);
    }
    if (r.hookType) {
      hookTypeCounts.set(r.hookType, (hookTypeCounts.get(r.hookType) || 0) + 1);
    }
  }
  return { structureCounts, hookTypeCounts };
}

export async function getRecentStructureAndHookUsage(brandId: string): Promise<StructureHookUsage> {
  const rows = await db
    .select({ structureTemplate: projects.structureTemplate, hookType: projects.hookType })
    .from(projects)
    .where(and(eq(projects.brandId, brandId), eq(projects.type, "video")))
    .orderBy(desc(projects.createdAt))
    .limit(RECENT_PROJECTS_WINDOW);
  return tallyStructureAndHookUsage(rows);
}

// Weighted least-recently-used pick - beda dari footageVariety's selectBalancedRealFootage
// (strict sort by exact recency timestamp, ties nyaris tidak pernah terjadi krn fileUrl
// unik+timestamp presisi milidetik): di sini COUNT dari window kecil SERING seri (mis.
// semua template masih 0 di awal umur brand). Random DI ANTARA yg minimum menjaga sifat
// anti-monoton (tidak pernah pilih yg overused selama ada yg belum) TANPA membuat
// rotasi terasa kaku (strict "index array pertama menang" akan selalu pilih template yg
// SAMA tiap kali ada seri - justru kaku di kasus paling umum, brand baru).
export function pickLeastUsedTemplate<T extends { name: string }>(
  pool: T[],
  usageCounts: Map<string, number>
): T {
  const counted = pool.map((item) => ({ item, count: usageCounts.get(item.name) ?? 0 }));
  const minCount = Math.min(...counted.map((c) => c.count));
  const candidates = counted.filter((c) => c.count === minCount).map((c) => c.item);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function isStructureOverused(structureTemplate: string, usage: StructureHookUsage): boolean {
  return (usage.structureCounts.get(structureTemplate) ?? 0) > STRUCTURE_REPEAT_THRESHOLD;
}

export function isHookTypeOverused(hookType: string | null, usage: StructureHookUsage): boolean {
  if (!hookType) return false;
  return (usage.hookTypeCounts.get(hookType) ?? 0) > HOOK_REPEAT_THRESHOLD;
}

// Instruksi "hindari" utk disuntik ke prompt LLM (2026-08-14) - soft steer, BUKAN hard
// constraint (model tetap boleh pilih tipe yg sudah sering dipakai kalau itu benar2
// paling cocok - pickLeastUsedTemplate & isStructureOverused/isHookTypeOverused di atas
// adalah backstop kode yg sesungguhnya, ini cuma bantu model condong ke arah yg benar
// dari awal supaya regenerasi lebih jarang perlu terjadi).
export function buildHookAvoidInstruction(hookTypeCounts: Map<string, number>): string {
  const overused = [...hookTypeCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1]);
  if (overused.length === 0) return "";
  const list = overused.map(([type, count]) => `${type} (${count}x)`).join(", ");
  return ` Hook type yang SUDAH sering dipakai belakangan (hindari kalau memungkinkan, cari sudut lain): ${list}.`;
}
