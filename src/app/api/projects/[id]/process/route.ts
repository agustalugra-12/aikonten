import { NextRequest, NextResponse } from "next/server";
import { processProject } from "@/lib/pipeline/processProject";
import { LockBusyError } from "@/lib/concurrency/locks";
import { getUserId, getOwnedProject } from "@/lib/session";

// Trigger manual dari NewProjectDialog.tsx setelah upload footage selesai. Logika
// pipeline-nya sendiri ada di lib/pipeline/processProject.ts (dipakai bareng dgn
// /api/brands/[id]/auto-content, lihat memory proyek).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id } = await params;
  if (!(await getOwnedProject(userId, id))) {
    return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  }

  try {
    const result = await processProject(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // Lock per-projectId (2026-08-14, temuan #1) - project ini sedang diproses proses
    // lain, balikin 409 jelas drpd 500 generik.
    if (err instanceof LockBusyError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : String(err);
    const status = message === "Project tidak ditemukan" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
