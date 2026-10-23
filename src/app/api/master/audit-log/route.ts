import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { getAdminOrNull } from "@/lib/admin";

// Baca 100 entri audit terbaru (admin-only). JOIN users utk email target saat ini (null
// kalau target sudah dihapus/anonim).
export async function GET(req: NextRequest) {
  const admin = await getAdminOrNull(req);
  if (!admin) return NextResponse.json({ error: "Akses khusus admin" }, { status: 403 });
  const entries = db.all(sql`
    SELECT a.id, a.admin_email AS adminEmail, a.aksi, a.target_user_id AS targetUserId,
           u.email AS targetEmail, a.detail, a.created_at AS createdAt
    FROM audit_log a LEFT JOIN users u ON u.id = a.target_user_id
    ORDER BY a.created_at DESC LIMIT 100`);
  return NextResponse.json({ entries });
}
