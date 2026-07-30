import { NextRequest, NextResponse } from "next/server";
import { publishProject } from "@/lib/publish/orchestrate";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";

// Retry manual - dipakai kalau publish otomatis (dipanggil dari /process) gagal krn
// alasan sementara (mis. rendering final belum ada saat itu, token expired, dst) dan
// Agus mau coba lagi tanpa harus regenerate ulang seluruh konten dari awal.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await publishProject(id);
  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  return NextResponse.json(project);
}
