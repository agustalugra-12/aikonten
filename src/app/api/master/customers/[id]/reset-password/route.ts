import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getAdminOrNull } from "@/lib/admin";
import { hashPassword } from "@/lib/auth";
import { catatAudit } from "@/lib/audit";

// Admin reset password pelanggan dari Master Dashboard (2026-10-11) - pengganti reset
// self-service via email (infra email belum ada). Admin set password baru, lalu beri tahu
// pelanggan lewat WA. Hanya admin. Min 8 karakter.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminOrNull(req);
  if (!admin) return NextResponse.json({ error: "Akses khusus admin" }, { status: 403 });
  const { id } = await params;
  const { newPassword } = await req.json().catch(() => ({}));
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return NextResponse.json({ error: "Password baru minimal 8 karakter" }, { status: 400 });
  }
  const [target] = await db.select().from(users).where(eq(users.id, id));
  if (!target) return NextResponse.json({ error: "Pelanggan tidak ditemukan" }, { status: 404 });
  await db.update(users).set({ passwordHash: await hashPassword(newPassword) }).where(eq(users.id, id));
  await catatAudit({ adminEmail: admin.email, aksi: "reset_password", targetUserId: id });
  return NextResponse.json({ ok: true });
}
