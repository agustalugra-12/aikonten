import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sql, eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { getAdminOrNull, isAdminEmail } from "@/lib/admin";
import { sendTelegramNotification } from "@/lib/publish/telegram";
import { catatAudit } from "@/lib/audit";

// Hapus data pelanggan - ANONYMIZE + purge konten (PDP, 2026-10-11 #5; keputusan Agus:
// BUKAN hard-delete total). Scrub data pribadi (email/nama/WA) + hapus brand+konten+aset+
// kredit, TAPI SIMPAN billing_log (teranonim via stub user yg tetap ada) utk catatan
// keuangan/pajak - UU PDP membolehkan retensi utk kewajiban hukum/finansial. Akun tak
// bisa login lagi (password_hash di-scramble + status "dihapus"). IRREVERSIBLE - wajib
// { konfirmasi: "HAPUS" }. Admin-only. foreign_keys OFF di DB (dicek) jadi hapus manual
// urut anak->induk, dibungkus transaksi (atomic). TOLAK menghapus akun admin/owner.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminOrNull(req);
  if (!admin) return NextResponse.json({ error: "Akses khusus admin" }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (body?.konfirmasi !== "HAPUS") {
    return NextResponse.json({ error: 'Kirim { "konfirmasi": "HAPUS" } untuk konfirmasi penghapusan permanen' }, { status: 400 });
  }
  const [target] = await db.select().from(users).where(eq(users.id, id));
  if (!target) return NextResponse.json({ error: "Pelanggan tidak ditemukan" }, { status: 404 });
  if (isAdminEmail(target.email) || target.unlimited) {
    return NextResponse.json({ error: "Akun admin/internal tidak boleh dihapus lewat endpoint ini" }, { status: 400 });
  }

  const emailAsli = target.email;
  const brandRows = (await db.all(sql`SELECT id FROM brands WHERE user_id = ${id}`)) as unknown as { id: string }[];
  const [{ c: nKonten }] = (await db.all(sql`SELECT COUNT(*) AS c FROM projects WHERE brand_id IN (SELECT id FROM brands WHERE user_id = ${id})`)) as unknown as { c: number }[];

  const B = sql`(SELECT id FROM brands WHERE user_id = ${id})`;
  const S = sql`(SELECT id FROM social_accounts WHERE brand_id IN (SELECT id FROM brands WHERE user_id = ${id}))`;
  const P = sql`(SELECT id FROM projects WHERE brand_id IN (SELECT id FROM brands WHERE user_id = ${id}))`;
  // Urut anak -> induk (content_types & llm_balances = global, JANGAN disentuh).
  const purge = [
    sql`DELETE FROM analytics WHERE social_account_id IN ${S}`,
    sql`DELETE FROM channel_profiles WHERE social_account_id IN ${S}`,
    sql`DELETE FROM youtube_series WHERE social_account_id IN ${S}`,
    sql`DELETE FROM media_assets WHERE project_id IN ${P}`,
    sql`DELETE FROM publish_logs WHERE project_id IN ${P}`,
    sql`DELETE FROM llm_usage_log WHERE brand_id IN ${B}`,
    sql`DELETE FROM content_plan WHERE brand_id IN ${B}`,
    sql`DELETE FROM daily_ideas WHERE brand_id IN ${B}`,
    sql`DELETE FROM manual_ideas WHERE brand_id IN ${B}`,
    sql`DELETE FROM storyboards WHERE brand_id IN ${B}`,
    sql`DELETE FROM footage_bank WHERE brand_id IN ${B}`,
    sql`DELETE FROM footage_categories WHERE brand_id IN ${B}`,
    sql`DELETE FROM music_bank WHERE brand_id IN ${B}`,
    sql`DELETE FROM competitors WHERE brand_id IN ${B}`,
    sql`DELETE FROM platform_policies WHERE brand_id IN ${B}`,
    sql`DELETE FROM social_accounts WHERE brand_id IN ${B}`,
    sql`DELETE FROM projects WHERE brand_id IN ${B}`,
    sql`DELETE FROM brands WHERE user_id = ${id}`,
    sql`DELETE FROM credit_transactions WHERE user_id = ${id}`,
  ];
  const anonEmail = `deleted-${id}@deleted.local`;
  const nowSec = Math.floor(Date.now() / 1000);

  db.transaction((tx) => {
    for (const st of purge) tx.run(st);
    // Billing_log SENGAJA dipertahankan (user_id tetap valid -> stub teranonim).
    tx.run(sql`UPDATE users SET email = ${anonEmail}, password_hash = 'DELETED', nama = NULL, nomor_wa = NULL, nama_bisnis = NULL, plan_id = NULL, status = 'dihapus', periode_mulai = NULL, periode_berakhir = NULL, saldo_kredit = 0, diblokir_admin = 1, langganan_dibatalkan = 1, dihapus_at = ${nowSec} WHERE id = ${id}`);
  });

  await catatAudit({ adminEmail: admin.email, aksi: "hapus_data", targetUserId: id, detail: `${emailAsli}; ${brandRows.length} brand, ${nKonten} konten` });
  // Jejak audit ke owner via Telegram (selain tabel audit_log).
  void sendTelegramNotification(
    `\u{1F5D1} <b>Data pelanggan dihapus (anonymized)</b>\n` +
    `${emailAsli}\n` +
    `oleh admin: ${admin.email}\n` +
    `${brandRows.length} brand & ${nKonten} konten dibersihkan · billing disimpan (teranonim)`,
  ).catch(() => {});

  return NextResponse.json({ ok: true, brand_dihapus: brandRows.length, konten_dihapus: nKonten });
}
