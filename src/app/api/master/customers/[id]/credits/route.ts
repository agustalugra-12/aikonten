import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getAdminOrNull } from "@/lib/admin";
import { isiUlangKredit } from "@/lib/billing/credits";

// Tambah kredit manual ke 1 pelanggan (2026-09-30) - untuk kasus: kompensasi generate
// gagal, bonus, koreksi, atau aktivasi manual sebelum payment gateway tersambung. Hanya
// admin. Memakai isiUlangKredit() yang sama dengan alur langganan otomatis - jadi tercatat
// di creditTransactions (audit) & cache saldoKredit ikut ter-update, tidak menembus jalur
// ledger resmi. jumlah harus > 0 (untuk mengurangi kredit, pakai alur lain nanti).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminOrNull(req);
  if (!admin) {
    return NextResponse.json({ error: "Akses khusus admin" }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json();

  const jumlah = Number(body.jumlah);
  if (!Number.isFinite(jumlah) || jumlah <= 0) {
    return NextResponse.json({ error: "jumlah harus angka > 0" }, { status: 400 });
  }
  const catatan =
    typeof body.catatan === "string" && body.catatan.trim()
      ? body.catatan.trim()
      : "penyesuaian manual admin";

  const [target] = await db.select().from(users).where(eq(users.id, id));
  if (!target) {
    return NextResponse.json({ error: "Pelanggan tidak ditemukan" }, { status: 404 });
  }

  const { saldoSetelah } = await isiUlangKredit(id, jumlah, `admin: ${catatan}`);
  return NextResponse.json({ ok: true, saldoSetelah });
}
