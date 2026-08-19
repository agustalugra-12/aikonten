import { db } from "@/db";
import { projects, contentTypes } from "@/db/schema";
import { and, eq, desc, isNotNull } from "drizzle-orm";

// Anti-monoton utk struktur video & tipe hook (2026-08-14, PRD "AI Content
// Intelligence" Fase 1, permintaan Agus - lihat spec doc utk detail lengkap). Window
// LEBIH KECIL drpd contentSimilarity.ts (20) & LEBIH BESAR drpd footageVariety.ts (5):
// pool structureTemplate/hookType cuma py 5-11 nilai mungkin (jauh lebih sedikit drpd
// ratusan footage asset ATAU teks caption bebas) - window 20 bikin threshold "lebih
// dari Nx" jadi tidak berarti (hampir semua nilai akan muncul >Nx murni dari rotasi
// merata di window sebesar itu), sementara window 5 terlalu mepet (brand dgn
// pillar/topik terbatas WAJAR mengulang struktur dlm 5 post tanpa itu benar2 monoton).
const RECENT_PROJECTS_WINDOW = 8;

// Threshold deteksi pengulangan (2026-08-14, DIREVISI 2026-08-19 - lihat bawah) -
// dipilih supaya kira2 sebanding dgn ukuran pool masing2, flag SEBELUM suatu pola jadi
// dominan di window, bukan sesudah.
const STRUCTURE_REPEAT_THRESHOLD = 2;
// HOOK_REPEAT_THRESHOLD DITURUNKAN 3->2 (2026-08-19, bug nyata ditemukan Agus - "footage
// masih monoton pemilihannya", digali lebih dalam ternyata hookType-nya juga: cek data
// produksi 30 hari terakhir, "direct_benefit" dipakai di 46-48% konten TERBARU Pelangi &
// Laundry In Bali [11/23 & 11/24], padahal mekanisme anti-monoton ini SUDAH aktif &
// SUDAH ke-trigger berkali-kali - akar masalahnya threshold >3 (butuh 4/8=50% dulu baru
// dianggap overused) itu JUSTRU PALING LONGGAR dari 3 dimensi ini, padahal pool hook (11
// tipe) PALING BESAR di antara ketiganya (structure ~5-7, content type 16) - harusnya
// threshold-nya proporsional LEBIH KETAT bukan lebih longgar. Diturunkan ke 2 (samakan
// dgn structure/content type) supaya regen loop di processProject.ts ke-trigger lebih
// awal. CATATAN: regen loop sendiri MAX_REGEN_ATTEMPTS=2 (di processProject.ts, TIDAK
// diubah di sini - file itu sedang ada WIP paralel) - kalau setelah perbaikan ini
// monoton MASIH terjadi, kandidat perbaikan lanjutan: naikkan MAX_REGEN_ATTEMPTS, atau
// buat hookType dipilih PROAKTIF (pickLeastUsedTemplate-style) sebelum generate, sama
// pola dgn structureTemplate/contentType - BUKAN cuma reaktif classify-lalu-cek spt
// sekarang (satu2nya dari 3 dimensi ini yg masih murni reaktif).
const HOOK_REPEAT_THRESHOLD = 2;
const CONTENT_TYPE_REPEAT_THRESHOLD = 2;
// Pool content types lebih kecil (16 types) - threshold 2 berarti 25% dari window 8.
// Flag SEBELIKTNYA type jadi dominan (lebih from 25% usage).

export type StructureHookUsage = {
  structureCounts: Map<string, number>;
  hookTypeCounts: Map<string, number>;
};

// Content Type Usage (2026-08-14, TIER 1+2) - extensible content types (bukan enum hardcode)
export type ContentTypeUsage = {
  typeCounts: Map<string, number>;
};

// Fungsi MURNI (2026-08-14) - tally content type usage dari rows
export function tallyContentTypeUsage(
  rows: { contentTypeId: string | null }[]
): ContentTypeUsage {
  const typeCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.contentTypeId) {
      typeCounts.set(r.contentTypeId, (typeCounts.get(r.contentTypeId) || 0) + 1);
    }
  }
  return { typeCounts };
}

// Get recent content type usage dari DB (window 8 projects)
export async function getRecentContentTypeUsage(brandId: string): Promise<ContentTypeUsage> {
  const rows = await db
    .select({ contentTypeId: projects.contentTypeId })
    .from(projects)
    .where(and(eq(projects.brandId, brandId), isNotNull(projects.contentTypeId)))
    .orderBy(desc(projects.createdAt))
    .limit(RECENT_PROJECTS_WINDOW);
  return tallyContentTypeUsage(rows);
}

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

export function isContentTypeOverused(contentTypeId: string, usage: ContentTypeUsage): boolean {
  return (usage.typeCounts.get(contentTypeId) ?? 0) > CONTENT_TYPE_REPEAT_THRESHOLD;
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

// Instruksi "hindari" untuk content type (2026-08-14) - soft steer, BUKAN hard constraint
export function buildContentTypeAvoidInstruction(typeCounts: Map<string, number>): string {
  const overused = [...typeCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1]);
  if (overused.length === 0) return "";
  const list = overused.map(([type, count]) => `${type} (${count}x)`).join(", ");
  return ` Content type yang SUDAH sering dipakai belakangan (hindari kalau memungkinkan, variasi dengan type lain): ${list}.`;
}

// Weighted pick untuk content type ID (2026-08-14) - beda dari pickLeastUsedTemplate
// karena content types tidak punya property 'name' atau 'id' standard.
export function pickUnderusedContentType<T extends { id: string }>(
  pool: T[],
  usageCounts: Map<string, number>
): T {
  const counted = pool.map((item) => ({ item, count: usageCounts.get(item.id) ?? 0 }));
  const minCount = Math.min(...counted.map((c) => c.count));
  const candidates = counted.filter((c) => c.count === minCount).map((c) => c.item);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// Pillar Target Enforcement (2026-08-19, bug nyata ditemukan Agus - "Pelangi 100%
// numpuk 1 pilar, 0% Edukasi" walau brands.contentPillars sudah set target 35%/15%/dst).
// Root cause: pillarTargetPercentForSite() (generateContent.ts) DIHITUNG tapi HANYA
// dipakai researchTopics.ts (bias saran IDE) - saat konten SUNGGUHAN diklasifikasi
// pilarnya di sini, tidak ada mekanisme "hindari pilar yg sudah kelebihan target" sama
// sekali, beda dari hookType/structureTemplate/contentType yg SUDAH py itu (fungsi2 di
// atas). Fungsi2 di bawah menutup celah itu, pola SAMA persis dgn buildHookAvoidInstruction
// - dipakai generateContent.ts, TIDAK mengubah pillarsForSite/pillarTargetPercentForSite
// yg sudah ada (itu tetap sumber DAFTAR pilar & TARGET-nya, cuma sekarang ada penegak
// tambahan saat klasifikasi final).
// windowSize DIKEMBALIKAN eksplisit (2026-08-19, bukan diasumsikan = RECENT_PROJECTS_WINDOW
// konstan) - brand baru/topik sempit bisa py < 8 project berpilar dalam riwayatnya, kalau
// dianggap tetap 8 maka persentase realisasi jadi UNDERESTIMATE (mis. 1 dari 3 project asli
// dihitung 1/8=12.5% padahal sebenarnya 33%) - caller (generateContent.ts) WAJIB pakai
// windowSize ini, bukan konstanta terpisah, utk isPillarOverused/buildPillarAvoidInstruction.
export async function getRecentPillarUsage(brandId: string): Promise<{ counts: Map<string, number>; windowSize: number }> {
  const rows = await db
    .select({ pillar: projects.pillar })
    .from(projects)
    .where(and(eq(projects.brandId, brandId), isNotNull(projects.pillar)))
    .orderBy(desc(projects.createdAt))
    .limit(RECENT_PROJECTS_WINDOW);
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.pillar) counts.set(r.pillar, (counts.get(r.pillar) || 0) + 1);
  }
  return { counts, windowSize: rows.length };
}

// Toleransi 15 poin persentase DI ATAS target (2026-08-19) - window cuma 8 project,
// realisasi persentase WAJAR berfluktuasi cukup lebar dari target jangka panjang tanpa
// itu benar2 berarti "melenceng" (mis. target 15% dari window 8 = ~1.2 - sekali post
// ekstra saja sudah lompat ke 25%). Baru diflag kalau MELEBIHI target scr jelas, bukan
// sedikit di atasnya - kasus nyata Pelangi (0% Edukasi target 15%, 100% "Pelangi
// Homestay" target 35%) jauh melewati margin ini, jadi tetap tertangkap.
const PILLAR_OVERUSE_MARGIN_PERCENT = 15;

export function isPillarOverused(
  pillar: string,
  usage: Map<string, number>,
  targetPercent: Record<string, number>,
  windowSize: number
): boolean {
  if (windowSize === 0) return false;
  const target = targetPercent[pillar];
  if (target === undefined) return false; // pilar di luar daftar target dikenal - jangan halangi
  const count = usage.get(pillar) ?? 0;
  const actualPercent = (count / windowSize) * 100;
  return actualPercent > target + PILLAR_OVERUSE_MARGIN_PERCENT;
}

// Instruksi "hindari" untuk pilar (2026-08-19) - soft steer sama filosofi dgn hook/
// content type di atas (model tetap boleh pilih kalau BENAR-BENAR paling cocok, ini
// backstop kode di isPillarOverused yg sesungguhnya menegakkan).
export function buildPillarAvoidInstruction(
  usage: Map<string, number>,
  targetPercent: Record<string, number>,
  windowSize: number
): string {
  if (windowSize === 0 || Object.keys(targetPercent).length === 0) return "";
  const overused = Object.keys(targetPercent).filter((p) =>
    isPillarOverused(p, usage, targetPercent, windowSize)
  );
  if (overused.length === 0) return "";
  const list = overused
    .map((p) => {
      const count = usage.get(p) ?? 0;
      const pct = Math.round((count / windowSize) * 100);
      return `${p} (dipakai ${pct}% belakangan, target cuma ${targetPercent[p]}%)`;
    })
    .join(", ");
  return ` Pilar berikut SUDAH MELEBIHI target porsinya belakangan (hindari kalau memungkinkan, condongkan ke pilar lain yang masih di bawah target): ${list}.`;
}
