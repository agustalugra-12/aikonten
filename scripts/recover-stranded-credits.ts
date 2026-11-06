/**
 * Pemulihan tagihan "sukses tanpa kredit" (2026-11-06, billing-hardening P0.3).
 * Deteksi billing_log status=sukses yang TIDAK punya credit_transactions ber-ref (= kredit tak
 * pernah masuk) lalu perbaiki SEKALI via grantCreditIdempotent (kunci ref_billing_id -> tak dobel).
 *
 * KONSERVATIF (anti double-credit data lama): sebelum kolom ref ada, kredit TIDAK ber-ref. Maka
 * tagihan lama yg SUDAH dikredit juga tampak "tanpa ref". Skrip MELEWATI baris yg punya kredit
 * PLAUSIBEL tak-ber-ref (user+jumlah sama, dalam +-2 hari) - itu kemungkinan sudah dikredit dulu.
 * Hanya baris tanpa jejak kredit sama sekali yang di-heal.
 *
 * DRY-RUN default (cuma lapor). Tambah --apply utk benar-benar grant.
 * Jalankan: DATABASE_PATH=/path/ke/kontenpilot.db npx tsx scripts/recover-stranded-credits.ts [--apply]
 * (BACKUP dulu sebelum --apply.)
 */
import { sqlite } from "../src/db";
import { grantCreditIdempotent } from "../src/lib/billing/credits";

const APPLY = process.argv.includes("--apply");
type Row = { id: string; user_id: string; jenis: string; kredit_topup: number | null; kredit_bulanan: number | null; created_at: number };

const rows = sqlite.prepare(`
  SELECT b.id, b.user_id, b.jenis, b.kredit_topup, p.kredit_bulanan, b.created_at
  FROM billing_log b LEFT JOIN plans p ON p.id = b.plan_id
  WHERE b.status = 'sukses'
    AND NOT EXISTS (SELECT 1 FROM credit_transactions c WHERE c.ref_billing_id = b.id)
`).all() as Row[];

const WIN = 2 * 24 * 60 * 60; // detik (timestamp mode = detik)
let healed = 0, ambiguous = 0, nol = 0, stranded = 0;

for (const r of rows) {
  const amount = r.jenis === "topup" ? (r.kredit_topup ?? 0) : (r.kredit_bulanan ?? 0);
  if (amount <= 0) { nol++; continue; }
  const pl = sqlite.prepare(
    `SELECT COUNT(*) n FROM credit_transactions WHERE user_id=? AND jumlah=? AND ref_billing_id IS NULL AND ABS(created_at - ?) <= ?`
  ).get(r.user_id, amount, r.created_at, WIN) as { n: number };
  if (pl.n > 0) { ambiguous++; console.log(`  ~ ${r.id} (${r.jenis} ${amount}) kemungkinan sudah dikredit sebelum kolom ref -> LEWATI`); continue; }
  stranded++;
  console.log(`  ! STRANDED ${r.id} (${r.jenis} ${amount} kredit) user=${r.user_id}`);
  if (APPLY) {
    const alasan = r.jenis === "topup" ? `top-up ${amount} kredit (pemulihan)` : "isi_ulang_bulanan (pemulihan)";
    const g = grantCreditIdempotent(r.user_id, amount, alasan, r.id);
    console.log(`     -> ${g ? "DI-GRANT" : "sudah ada (idempoten) - lewati"}`);
    if (g) healed++;
  }
}

console.log(`\nTotal tanpa-ref: ${rows.length} | stranded: ${stranded} | ambigu(dilewati): ${ambiguous} | nol-kredit: ${nol}`);
if (APPLY) console.log(`DI-HEAL: ${healed}`);
else console.log("DRY-RUN. Jalankan dengan --apply untuk memperbaiki stranded.");
process.exit(0);
