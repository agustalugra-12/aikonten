import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { getAdminOrNull } from "@/lib/admin";

// Daftar pembayaran PENDING (2026-10-23, #5) utk Master - admin lihat antrean yang perlu
// dikonfirmasi manual di satu tempat (selain notif Telegram per-order). Admin-only.
export async function GET(req: NextRequest) {
  const admin = await getAdminOrNull(req);
  if (!admin) return NextResponse.json({ error: "Akses khusus admin" }, { status: 403 });
  const entries = db.all(sql`
    SELECT b.id, b.user_id AS userId, b.jenis, b.jumlah_bayar_idr AS jumlahIdr, b.kredit_topup AS kreditTopup,
           b.gateway_ref AS gatewayRef, b.created_at AS createdAt,
           u.email, u.nama_bisnis AS namaBisnis, u.nama, u.nomor_wa AS nomorWa, p.nama AS planNama
    FROM billing_log b JOIN users u ON u.id = b.user_id LEFT JOIN plans p ON p.id = b.plan_id
    WHERE b.status = 'pending' ORDER BY b.created_at DESC LIMIT 100`);
  return NextResponse.json({ entries });
}
