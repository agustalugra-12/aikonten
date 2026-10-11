import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { getAdminOrNull } from "@/lib/admin";

// Export data pelanggan (PDP/hak akses data, 2026-10-11 #5). Admin unduh SEMUA data 1
// pelanggan sbg JSON utk diserahkan atas permintaan. Admin-only. SENGAJA mengecualikan
// RAHASIA: users.password_hash & token OAuth social_accounts (access_token/refresh_token)
// - jangan pernah ikut. Tabel operasional bulky (media_assets, publish_logs, analytics,
// llm_usage_log, footage/music bank) dikecualikan: data turunan, bukan data pribadi.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminOrNull(req);
  if (!admin) return NextResponse.json({ error: "Akses khusus admin" }, { status: 403 });
  const { id } = await params;

  const rows = (q: ReturnType<typeof sql>) => db.all(q) as unknown as Record<string, unknown>[];
  const [user] = rows(sql`SELECT id, email, nama, nomor_wa, nama_bisnis, status, plan_id, saldo_kredit, periode_mulai, periode_berakhir, setuju_at, created_at FROM users WHERE id = ${id}`);
  if (!user) return NextResponse.json({ error: "Pelanggan tidak ditemukan" }, { status: 404 });

  const brandSub = sql`(SELECT id FROM brands WHERE user_id = ${id})`;
  const data = {
    diekspor_pada: new Date().toISOString(),
    oleh_admin: admin.email,
    catatan: "Dikecualikan dari export: password, token OAuth, dan data operasional turunan (aset media, log publish, analitik, log pemakaian AI).",
    profil: user,
    tagihan: rows(sql`SELECT id, plan_id, jenis, kredit_topup, jumlah_bayar_idr, status, created_at FROM billing_log WHERE user_id = ${id} ORDER BY created_at`),
    transaksi_kredit: rows(sql`SELECT id, jumlah, alasan, saldo_setelah, ref_project_id, created_at FROM credit_transactions WHERE user_id = ${id} ORDER BY created_at`),
    brands: rows(sql`SELECT * FROM brands WHERE user_id = ${id}`),
    akun_sosial: rows(sql`SELECT id, brand_id, platform, publish_via, username, connected, created_at FROM social_accounts WHERE brand_id IN ${brandSub}`),
    konten: rows(sql`SELECT id, brand_id, type, content_format, status, pillar, angle, generated_caption, generated_hashtags, scheduled_for, created_at FROM projects WHERE brand_id IN ${brandSub} ORDER BY created_at`),
    ide_harian: rows(sql`SELECT * FROM daily_ideas WHERE brand_id IN ${brandSub}`),
    ide_manual: rows(sql`SELECT * FROM manual_ideas WHERE brand_id IN ${brandSub}`),
    rencana_konten: rows(sql`SELECT * FROM content_plan WHERE brand_id IN ${brandSub}`),
  };

  const slug = String(user.email).replace(/[^a-z0-9]+/gi, "_");
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="export-${slug}-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
