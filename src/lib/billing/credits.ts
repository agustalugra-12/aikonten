import { db } from "@/db";
import { users, creditTransactions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { newId } from "@/lib/ids";

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

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error(`User ${userId} tidak ditemukan`);
  if (user.saldoKredit < jumlah) {
    throw new SaldoTidakCukupError(user.saldoKredit, jumlah);
  }

  // ponytail: read-then-write, bukan atomic decrement - 2 request bersamaan utk akun yg
  // sama bisa balapan (race). Aman utk volume 1 user manual generate 1 project pada satu
  // waktu (pola pakai wajar); kalau nanti ada concurrency nyata per-akun, ganti ke
  // UPDATE ... SET saldo = saldo - ? WHERE saldo >= ? (atomic, DB yang jaga invariant).
  const saldoSetelah = user.saldoKredit - jumlah;
  await db.update(users).set({ saldoKredit: saldoSetelah }).where(eq(users.id, userId));
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

// Isi ulang kredit (langganan bulanan otomatis / refund proses gagal / penyesuaian
// manual Admin) - `jumlah` selalu POSITIF di sini juga (ledger mencatatnya apa adanya).
export async function isiUlangKredit(
  userId: string, jumlah: number, alasan: string
): Promise<{ saldoSetelah: number }> {
  if (jumlah <= 0) throw new Error("jumlah isi ulang kredit harus > 0");

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error(`User ${userId} tidak ditemukan`);

  const saldoSetelah = user.saldoKredit + jumlah;
  await db.update(users).set({ saldoKredit: saldoSetelah }).where(eq(users.id, userId));
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
