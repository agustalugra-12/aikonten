import { NextRequest, NextResponse } from "next/server";
import { publishProject } from "@/lib/publish/orchestrate";
import { LockBusyError } from "@/lib/concurrency/locks";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getUserId, getOwnedProject } from "@/lib/session";

// Retry manual - dipakai kalau publish otomatis (dipanggil dari /process) gagal krn
// alasan sementara (mis. rendering final belum ada saat itu, token expired, dst) dan
// Agus mau coba lagi tanpa harus regenerate ulang seluruh konten dari awal.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id } = await params;
  if (!(await getOwnedProject(userId, id))) {
    return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  }
  try {
    await publishProject(id);
  } catch (err) {
    // Lock per-projectId (2026-08-14, temuan #2) - project ini sedang dipublikasikan
    // proses lain (klik dobel, atau balapan dgn cron auto-publish), balikin 409 jelas
    // drpd biarkan exception mentah jadi 500 generik Next.js.
    if (err instanceof LockBusyError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  return NextResponse.json(project);
}
