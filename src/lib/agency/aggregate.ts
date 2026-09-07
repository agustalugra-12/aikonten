import { db } from "@/db";
import { brands, projects } from "@/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { getWeeklyReportData } from "@/lib/reports/weeklyReportData";

// Agency Dashboard (2026-08-26, PRD §32, Task Plan 4) - dipisah dari route.ts supaya
// dipakai LANGSUNG (tanpa HTTP loopback) oleh /agency/page.tsx utk data server SENDIRI,
// & dipakai jg oleh brands-summary/route.ts utk melayani server LAIN.
export type AgencyBrandSummary = {
  brandId: string;
  brandName: string;
  statusCounts: Record<string, number>;
  totalContentAllTime: number;
  weekly: Awaited<ReturnType<typeof getWeeklyReportData>>;
};

// brandIds (2026-09-07, Fase 1 Alur D, fork multi-tenant) - repo asal (single-admin)
// selalu ambil SEMUA brand ("agency" = seluruh brand milik Agus). Di fork INI, "semua
// brand" tanpa filter berarti membocorkan ringkasan brand SEMUA pelanggan lain ke
// siapa pun yang login - WAJIB dibatasi ke brand milik userId yang login (lihat
// pemanggil di /api/agency/dashboard). Optional (bukan required) supaya
// brands-summary/route.ts (jalur server-ke-server lama, sudah dinonaktifkan di fork
// ini - lihat catatan di sana) tidak perlu diubah signature-nya kalau suatu saat
// diaktifkan lagi dgn model otorisasi yang benar.
export async function getLocalAgencySummaries(brandIds?: string[]): Promise<AgencyBrandSummary[]> {
  const allBrands = await db
    .select({ id: brands.id, name: brands.name })
    .from(brands)
    .where(brandIds ? inArray(brands.id, brandIds) : undefined);

  return Promise.all(
    allBrands.map(async (b) => {
      const statusRows = await db
        .select({ status: projects.status, count: sql<number>`count(*)` })
        .from(projects)
        .where(eq(projects.brandId, b.id))
        .groupBy(projects.status);
      const statusCounts: Record<string, number> = {};
      let totalContentAllTime = 0;
      for (const r of statusRows) {
        statusCounts[r.status] = r.count;
        totalContentAllTime += r.count;
      }
      const weekly = await getWeeklyReportData(b.id, 7);
      return { brandId: b.id, brandName: b.name, statusCounts, totalContentAllTime, weekly };
    })
  );
}

export type AgencyFetchResult = { source: string; brands: AgencyBrandSummary[]; error: string | null };

// Fungsi MURNI (2026-08-26) - gabungkan hasil dari beberapa sumber (server sendiri +
// peer), BUANG sumber yang gagal (network error dll) TANPA menggagalkan sumber lain -
// never blank the whole page krn 1 peer server down. Dipisah dari fetchPeerSummaries
// (yang punya efek samping network) supaya logic gabung bisa diverifikasi tanpa network.
export function mergeAgencySummaries(results: AgencyFetchResult[]): AgencyBrandSummary[] {
  return results.filter((r) => r.error === null).flatMap((r) => r.brands);
}

export function parsePeerUrls(envVal: string | undefined | null): string[] {
  if (!envVal) return [];
  return envVal
    .split(",")
    .map((u) => u.trim().replace(/\/$/, ""))
    .filter((u) => u.length > 0);
}

export async function fetchPeerSummaries(peerUrls: string[], secret: string): Promise<AgencyFetchResult[]> {
  return Promise.all(
    peerUrls.map(async (url): Promise<AgencyFetchResult> => {
      try {
        const res = await fetch(`${url}/api/agency/brands-summary`, {
          headers: { "x-agency-key": secret },
          cache: "no-store",
        });
        if (!res.ok) return { source: url, brands: [], error: `HTTP ${res.status}` };
        const data = await res.json();
        return { source: url, brands: data.brands ?? [], error: null };
      } catch (err) {
        return { source: url, brands: [], error: err instanceof Error ? err.message : String(err) };
      }
    })
  );
}
