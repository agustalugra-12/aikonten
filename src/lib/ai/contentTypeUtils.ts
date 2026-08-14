// Content Type Utilities (2026-08-14, TIER 3)
// Utility functions untuk content type analysis dan reporting
// TIDAK mengubah existing diversity logic, hanya ADDITIONAL signals

import { db } from "@/db";
import { projects, contentTypes } from "@/db/schema";
import { and, eq, isNotNull, desc } from "drizzle-orm";

// Content Type Window (sama dengan contentVariety.ts)
const RECENT_PROJECTS_WINDOW = 8;

// Content Type Distribution per brand
export type ContentTypeDistribution = {
  typeId: string;
  typeName: string;
  count: number;
  percentage: number;
  total: number;
};

export async function getContentTypeDistribution(brandId: string): Promise<ContentTypeDistribution[]> {
  const rows = await db
    .select({ typeId: projects.contentTypeId })
    .from(projects)
    .where(and(eq(projects.brandId, brandId), isNotNull(projects.contentTypeId)))
    .groupBy(projects.contentTypeId)
    .all();

  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.typeId) {
      counts.set(r.typeId, (counts.get(r.typeId) || 0) + 1);
    }
  }

  const total = [...counts.values()].reduce((sum, c) => sum + c, 0);
  if (total === 0) return [];

  // Join dengan content_types untuk name
  const typeIds = [...counts.keys()];
  const types = await db
    .select({ id: contentTypes.id, name: contentTypes.name })
    .from(contentTypes)
    .where(eq(contentTypes.id, typeIds[0]))
    .all();

  // Filter dan map types
  const typeMap = new Map<string, string>();
  for (const t of types) {
    if (t.id && t.name) typeMap.set(t.id, t.name);
  }

  return [...counts.entries()]
    .map(([typeId, count]) => ({
      typeId: typeId || "unknown",
      typeName: typeMap.get(typeId || "") || typeId || "unknown",
      count,
      percentage: Math.round((count / total) * 100),
      total,
    }))
    .sort((a, b) => b.count - a.count);
}

// Get recent content type usage (window 8)
export async function getRecentContentTypeUsage(brandId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ contentTypeId: projects.contentTypeId })
    .from(projects)
    .where(and(eq(projects.brandId, brandId), isNotNull(projects.contentTypeId)))
    .orderBy(desc(projects.createdAt))
    .limit(RECENT_PROJECTS_WINDOW);

  const usage = new Map<string, number>();
  for (const r of rows) {
    if (r.contentTypeId) {
      usage.set(r.contentTypeId, (usage.get(r.contentTypeId) || 0) + 1);
    }
  }
  return usage;
}

// Get content types that are overused (count > threshold)
export function getOverusedContentTypes(usage: Map<string, number>, threshold: number = 2): string[] {
  return [...usage.entries()]
    .filter(([, count]) => count > threshold)
    .map(([typeId]) => typeId);
}

// Get content types that are underused (count <= threshold)
export function getUnderusedContentTypes(usage: Map<string, number>, threshold: number = 2): string[] {
  return [...usage.entries()]
    .filter(([, count]) => count <= threshold)
    .map(([typeId]) => typeId);
}

// Get content type metadata
export async function getContentType(typeId: string) {
  return db
    .select()
    .from(contentTypes)
    .where(eq(contentTypes.id, typeId))
    .limit(1)
    .then(rows => rows[0] || null);
}

// Get all active content types
export async function getActiveContentTypes() {
  return db
    .select()
    .from(contentTypes)
    .where(eq(contentTypes.isActive, true))
    .orderBy(contentTypes.name)
    .all();
}

// Get compatible structures for a content type
export async function getCompatibleStructures(typeId: string): Promise<string[]> {
  const type = await getContentType(typeId);
  if (!type || !type.compatibleStructures) return [];
  try {
    return JSON.parse(type.compatibleStructures) as string[];
  } catch {
    return [];
  }
}

// Filter structures by compatibility
export async function filterCompatibleStructures(
  structures: { name: string; guide: string }[],
  typeId: string | null
): Promise<{ name: string; guide: string }[]> {
  if (!typeId) return structures; // NULL = no filter

  const compatible = await getCompatibleStructures(typeId);
  if (compatible.length === 0) return structures; // Jika tidak ada data compatible, gunakan semua

  return structures.filter(s => compatible.includes(s.name));
}
