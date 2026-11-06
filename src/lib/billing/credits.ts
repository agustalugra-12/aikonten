import { db } from "@/db";
import { users, creditTransactions } from "@/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { newId } from "@/lib/ids";

// Tipe argumen transaksi Drizzle (diturunkan dari db.transaction) - supaya _grantOnTx bisa
// dipanggil DI DALAM transaksi aktivasi/paket maupun transaksinya sendiri, tetap type-safe.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Primitif ledger kredit (2026-09-08, Fase 1 Alur B) - "Setiap kali generate konten,
// potong kredit". `saldoKredit` di users adalah CACHE (dibaca cepat), creditTransactions
// adalah SUMBER KEBENARAN AUDIT (pola sama dgn payment_log/amount_due di PMS Pelangi) -
// keduanya WAJIB berubah bareng dalam 1 fungsi ini, tidak ada pemanggil lain yang boleh
// UPDATE saldoKredit langsung.
//
// Dipasang ke /api/projects/[id]/process & /api/projects/[id]/retry (2 satu2nya titik
// yang benar2 memanggil processProject.ts, generate konten sungguhan) via
// CREDIT_COST_GENERATE di bawah - SEMUA ANGKA DI SITU PLACEHOLDER, Agus eksplisit
// "penentuan jumlah dan harga kredit bisa kita atur nanti". Sengaja masih konstanta kode
// (bukan tabel DB spt `plans`) supaya gampang ditemukan & diganti SATU tempat begitu ada
// keputusan asli - jangan anggap angka ini sudah final/siap tagih pelanggan sungguhan.
export const CREDIT_COST_GENERATE: Record<"video" | "carousel" | "caption", number> = {
  // Model final (2026-09-30, keputusan Agus): 1 konten = 1 kredit (foto/video/carousel/
  // caption dihitung sama). Cocok dgn kuota paket 50/100/150 = jumlah konten per bulan.
  video: 1,
  carousel: 1,
  caption: 1,
};

export class SaldoTidakCukupError extends Error {
  constructor(public saldoSekarang: number, public butuh: number) {
    super(`Saldo kredit tidak cukup (punya ${saldoSekarang}, butuh ${butuh})`);
  }
}

// Potong kredit akun - lempar SaldoTidakCukupError kalau saldo kurang (pemanggil putuskan
// apa yg terjadi ke fitur yg diminta, mis. tolak generate SEBELUM API mahal dipanggil,
// bukan sesudah). `jumlah` selalu POSITIF di sini (fungsi ini yg negasikan ke ledger).
export async function potongKredit(
  userId: string, jumlah: number, alasan: string, refProjectId?: string
): Promise<{ saldoSetelah: number }> {
  if (jumlah <= 0) throw new Error("jumlah potong kredit harus > 0");

  // (2026-09-30) Akun unlimited (owner/internal) TIDAK dipotong kredit - biaya asli
  // tercatat di llm_usage_log, bukan kredit. Cek sebelum decrement.
  const [akun] = await db.select().from(users).where(eq(users.id, userId));
  if (akun?.unlimited) {
    return { saldoSetelah: akun.saldoKredit };
  }

  // (2026-09-30, T2b) Atomic decrement - DB yang jaga invariant (saldo >= jumlah) lewat
  // WHERE, BUKAN read-then-write (anti-race: 2 generate bersamaan utk akun sama tak bisa
  // bikin saldo negatif). .returning() mengembalikan saldo BARU langsung tanpa select ulang.
  const updated = await db
    .update(users)
    .set({ saldoKredit: sql`${users.saldoKredit} - ${jumlah}` })
    .where(and(eq(users.id, userId), gte(users.saldoKredit, jumlah)))
    .returning({ saldoKredit: users.saldoKredit });
  if (updated.length === 0) {
    // 0 baris terupdate = user tak ada ATAU saldo kurang - bedakan utk pesan error benar.
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) throw new Error(`User ${userId} tidak ditemukan`);
    throw new SaldoTidakCukupError(user.saldoKredit, jumlah);
  }
  const saldoSetelah = updated[0].saldoKredit;
  await db.insert(creditTransactions).values({
    id: newId("credtx"),
    userId,
    jumlah: -jumlah,
    alasan,
    saldoSetelah,
    refProjectId: refProjectId ?? null,
    createdAt: new Date(),
  });
  return { saldoSetelah };
}

// Isi ulang kredit (penyesuaian manual Admin / refund proses gagal) - `jumlah` selalu POSITIF.
// (2026-11-06, P0.2) ATOMIK: increment lewat SATU statement SQL ber-WHERE (pola sama
// potongKredit), BUKAN read-then-write - cegah lost-update saat 2 grant akun sama bersamaan.
// CATATAN: fungsi ini TIDAK idempotent (tiap panggilan menambah). Untuk grant dari pembayaran
// (yg bisa di-retry gateway), pakai grantCreditIdempotent / prosesPembayaranSukses yang
// ber-kunci refBillingId - JANGAN pakai isiUlangKredit langsung di jalur webhook.
export async function isiUlangKredit(
  userId: string, jumlah: number, alasan: string
): Promise<{ saldoSetelah: number }> {
  if (jumlah <= 0) throw new Error("jumlah isi ulang kredit harus > 0");

  const updated = await db
    .update(users)
    .set({ saldoKredit: sql`${users.saldoKredit} + ${jumlah}` })
    .where(eq(users.id, userId))
    .returning({ saldoKredit: users.saldoKredit });
  if (updated.length === 0) throw new Error(`User ${userId} tidak ditemukan`);
  const saldoSetelah = updated[0].saldoKredit;
  await db.insert(creditTransactions).values({
    id: newId("credtx"),
    userId,
    jumlah,
    alasan,
    saldoSetelah,
    refProjectId: null,
    createdAt: new Date(),
  });
  return { saldoSetelah };
}

// (2026-11-06, P0.1/0.3) Grant kredit EXACTLY-ONCE ber-kunci refBillingId, di DALAM `tx` yang
// diberikan pemanggil (dipakai aktivasi paket & top-up supaya status+user+kredit 1 transaksi).
// Idempotensi NYATA: kalau sudah ada credit_transactions.ref_billing_id = refBillingId ->
// tidak menambah apa-apa (return false). Jadi retry webhook / pemulihan aman dari double-credit
// TANPA bergantung pada status "sukses" saja. Increment saldo = 1 statement SQL (tak lost-update).
export function _grantOnTx(
  tx: Tx,
  userId: string, jumlah: number, alasan: string, refBillingId: string
): boolean {
  if (jumlah <= 0) return false;
  const existing = tx.select({ id: creditTransactions.id }).from(creditTransactions)
    .where(eq(creditTransactions.refBillingId, refBillingId)).all();
  if (existing.length > 0) return false; // sudah di-grant utk tagihan ini - jangan dobel
  const updated = tx.update(users)
    .set({ saldoKredit: sql`${users.saldoKredit} + ${jumlah}` })
    .where(eq(users.id, userId))
    .returning({ saldoKredit: users.saldoKredit }).all();
  if (updated.length === 0) throw new Error(`User ${userId} tidak ditemukan`);
  tx.insert(creditTransactions).values({
    id: newId("credtx"),
    userId,
    jumlah,
    alasan,
    saldoSetelah: updated[0].saldoKredit,
    refProjectId: null,
    refBillingId,
    createdAt: new Date(),
  }).run();
  return true;
}

// Bungkus _grantOnTx dalam transaksi sendiri - dipakai jalur PEMULIHAN (recover-stranded-credits)
// di mana tak ada transaksi aktivasi/paket yang lebih besar untuk digabung.
export function grantCreditIdempotent(
  userId: string, jumlah: number, alasan: string, refBillingId: string
): boolean {
  return db.transaction((tx) => _grantOnTx(tx, userId, jumlah, alasan, refBillingId));
}
