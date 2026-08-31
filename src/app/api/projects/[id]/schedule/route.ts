import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";

// Manual Per-Post Scheduling (2026-08-25, PRD "AI Konten Intelligence & Agency Upgrade"
// §26) - BEDA dari brand.autoPublishTimes (jadwal RECURRING harian per-brand, lihat
// cron/auto-publish.ts) - ini override SEKALI PAKAI per draft spesifik: Agus pilih
// tanggal+jam tertentu utk 1 project, apa pun publishMode brand-nya. cron/auto-publish.ts
// cek status "scheduled" ini TERPISAH dari loop slot per-brand yang sudah ada.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const scheduledFor = typeof body.scheduledFor === "string" ? new Date(body.scheduledFor) : null;
  if (!scheduledFor || isNaN(scheduledFor.getTime())) {
    return NextResponse.json({ error: "scheduledFor wajib diisi, format ISO datetime valid" }, { status: 400 });
  }
  if (scheduledFor.getTime() <= Date.now()) {
    return NextResponse.json({ error: "scheduledFor harus di masa depan - kalau mau publish sekarang, pakai tombol Publikasikan Sekarang" }, { status: 400 });
  }

  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  if (!project) {
    return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  }
  // Hanya draft yang sudah "ready" (render selesai, siap dipublish) yang boleh
  // dijadwalkan - konsisten dengan tombol "Publikasikan Sekarang" yang juga hanya
  // muncul di status ini (lihat DraftReview.tsx).
  if (project.status !== "ready") {
    return NextResponse.json({ error: `Project berstatus "${project.status}" belum bisa dijadwalkan - hanya draft "ready".` }, { status: 400 });
  }

  await db.update(projects).set({ status: "scheduled", scheduledFor, updatedAt: new Date() }).where(eq(projects.id, id));
  const [updated] = await db.select().from(projects).where(eq(projects.id, id));
  return NextResponse.json(updated);
}

// Batalkan jadwal - kembalikan ke "ready" (draft biasa, publish manual/slot brand
// normal lagi) tanpa perlu regenerate ulang kontennya.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  if (!project) {
    return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  }
  if (project.status !== "scheduled") {
    return NextResponse.json({ error: `Project berstatus "${project.status}", bukan "scheduled".` }, { status: 400 });
  }
  await db.update(projects).set({ status: "ready", scheduledFor: null, updatedAt: new Date() }).where(eq(projects.id, id));
  const [updated] = await db.select().from(projects).where(eq(projects.id, id));
  return NextResponse.json(updated);
}
