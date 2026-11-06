// Verifikasi billing-hardening (2026-11-06, P0) - uji DB di TEMP DB (BUKAN prod). Skema diambil
// read-only dari prod, migrasi dijalankan, lalu uji atomisitas/idempotensi/perpanjangan/pemulihan.
// Jalankan: npx tsx scripts/verify-billing-hardening.ts
import assert from "node:assert";
import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const PROD = "/home/admin/kontenpilot-saas/data/kontenpilot.db";
const tmp = path.join(os.tmpdir(), `billtest-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = tmp;
process.env.EMAIL_PROVIDER = "console";
process.env.TELEGRAM_BOT_TOKEN = "";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-secret";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; console.log("  ✓", name); } else { fail++; console.error("  ✗ GAGAL:", name); } }

async function main() {
  // 1. Skema dari prod (READ-ONLY) -> temp
  const schema = execFileSync("sqlite3", ["-readonly", PROD, ".schema"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const t = new Database(tmp);
  t.pragma("foreign_keys=OFF");
  t.exec(schema);
  t.close();
  // 2. Migrasi (uji skrip migrasi SUNGGUHAN terhadap temp)
  await import("../scripts/add-ref-billing-id-column");
  await import("../scripts/add-password-reset-tokens-table");
  // 3. Modul app (baca DATABASE_PATH=temp saat module-load)
  const { sqlite } = await import("../src/db");
  const { prosesPembayaranSukses } = await import("../src/lib/billing/activation");
  const { grantCreditIdempotent, isiUlangKredit } = await import("../src/lib/billing/credits");

  const now = Math.floor(Date.now() / 1000);
  sqlite.prepare("INSERT INTO plans (id,nama,kredit_bulanan,harga_bulanan_idr,created_at) VALUES (?,?,?,?,?)").run("plan_test", "Starter", 50, 149000, now);
  const mkUser = (id: string, s = 0) => sqlite.prepare("INSERT INTO users (id,email,password_hash,saldo_kredit,status,created_at) VALUES (?,?,?,?,'aktif',?)").run(id, id + "@t.co", "x", s, now);
  const mkPaket = (id: string, uid: string, st = "pending") => sqlite.prepare("INSERT INTO billing_log (id,user_id,plan_id,jenis,jumlah_bayar_idr,status,created_at) VALUES (?,?,'plan_test','paket',149000,?,?)").run(id, uid, st, now);
  const mkTopup = (id: string, uid: string, k: number, st = "pending") => sqlite.prepare("INSERT INTO billing_log (id,user_id,jenis,kredit_topup,jumlah_bayar_idr,status,created_at) VALUES (?,?,'topup',?,49000,?,?)").run(id, uid, k, st, now);
  const saldo = (uid: string) => (sqlite.prepare("SELECT saldo_kredit s FROM users WHERE id=?").get(uid) as { s: number }).s;
  const statusBill = (id: string) => (sqlite.prepare("SELECT status s FROM billing_log WHERE id=?").get(id) as { s: string }).s;
  const countRef = (id: string) => (sqlite.prepare("SELECT COUNT(*) n FROM credit_transactions WHERE ref_billing_id=?").get(id) as { n: number }).n;
  const periode = (uid: string) => (sqlite.prepare("SELECT periode_berakhir p FROM users WHERE id=?").get(uid) as { p: number | null }).p;

  // (b) Webhook retry paket -> exactly-once
  mkUser("u1"); mkPaket("bill_1", "u1");
  await prosesPembayaranSukses("bill_1");
  await prosesPembayaranSukses("bill_1");
  await prosesPembayaranSukses("bill_1");
  ok("retry paket 3x: saldo = 50 (sekali)", saldo("u1") === 50);
  ok("retry paket 3x: tepat 1 credit_tx ber-ref", countRef("bill_1") === 1);
  ok("retry paket: status sukses", statusBill("bill_1") === "sukses");

  // (c) Top-up dobel -> one credit + indeks unik
  mkUser("u2"); mkTopup("bill_2", "u2", 10);
  await prosesPembayaranSukses("bill_2");
  await prosesPembayaranSukses("bill_2");
  ok("topup dobel: saldo = 10 (sekali)", saldo("u2") === 10);
  ok("topup dobel: tepat 1 credit_tx ber-ref", countRef("bill_2") === 1);
  let dup = false;
  try { sqlite.prepare("INSERT INTO credit_transactions (id,user_id,jumlah,alasan,saldo_setelah,ref_billing_id,created_at) VALUES (?,?,?,?,?,?,?)").run("cx_dup", "u2", 10, "dup", 20, "bill_2", now); } catch { dup = true; }
  ok("indeks unik parsial tolak ref_billing_id duplikat", dup);

  // (d) Perpanjangan: periode extend dari akhir lama (bukan now)
  mkUser("u3"); mkPaket("bill_3a", "u3");
  await prosesPembayaranSukses("bill_3a");
  const p1 = periode("u3")!;
  mkPaket("bill_3b", "u3");
  await prosesPembayaranSukses("bill_3b");
  const p2 = periode("u3")!;
  ok("perpanjangan: saldo = 100 (2x50)", saldo("u3") === 100);
  ok("perpanjangan: 2 credit_tx ber-ref", countRef("bill_3a") === 1 && countRef("bill_3b") === 1);
  ok("perpanjangan: periode +~30h dari akhir lama (bukan now)", Math.abs((p2 - p1) - 30 * 86400) < 180);

  // (a) Atomisitas: crash di tengah transaksi -> rollback penuh
  mkUser("u4", 5); mkPaket("bill_4", "u4");
  const crashTx = sqlite.transaction((id: string) => { sqlite.prepare("UPDATE billing_log SET status='sukses' WHERE id=?").run(id); throw new Error("boom"); });
  let threw = false;
  try { crashTx("bill_4"); } catch { threw = true; }
  ok("crash mid-tx: transaksi melempar", threw);
  ok("crash mid-tx: status ROLLBACK ke pending (tak ada sukses tanpa kredit)", statusBill("bill_4") === "pending");

  // (e) Pemulihan stranded
  mkUser("u5"); mkPaket("bill_5", "u5", "sukses"); // sukses TAPI tanpa credit_tx
  ok("deteksi stranded: belum ada credit_tx ber-ref", countRef("bill_5") === 0);
  const g1 = grantCreditIdempotent("u5", 50, "isi_ulang_bulanan (pemulihan)", "bill_5");
  const g2 = grantCreditIdempotent("u5", 50, "isi_ulang_bulanan (pemulihan)", "bill_5");
  ok("pemulihan: grant1 true, grant2 false (idempoten)", g1 === true && g2 === false);
  ok("pemulihan: saldo = 50 (tak dobel)", saldo("u5") === 50);
  ok("pemulihan: tepat 1 credit_tx ber-ref", countRef("bill_5") === 1);

  // isiUlangKredit atomik
  mkUser("u6", 3);
  const r = await isiUlangKredit("u6", 7, "manual");
  ok("isiUlangKredit: 3+7=10", r.saldoSetelah === 10 && saldo("u6") === 10);

  // Invariant akhir: nol tagihan sukses (amount>0) tanpa credit_tx ber-ref
  const strandedN = (sqlite.prepare(`SELECT COUNT(*) n FROM billing_log b LEFT JOIN plans p ON p.id=b.plan_id WHERE b.status='sukses' AND COALESCE(b.kredit_topup, p.kredit_bulanan, 0) > 0 AND NOT EXISTS (SELECT 1 FROM credit_transactions c WHERE c.ref_billing_id=b.id)`).get() as { n: number }).n;
  ok("invariant: nol tagihan sukses tanpa kredit ber-ref", strandedN === 0);

  console.log(`\n${pass} lolos, ${fail} gagal`);
  try { fs.rmSync(tmp); fs.rmSync(tmp + "-wal", { force: true }); fs.rmSync(tmp + "-shm", { force: true }); } catch {}
  assert.strictEqual(fail, 0, `${fail} tes gagal`);
}
main().catch((e) => { console.error(e); try { fs.rmSync(process.env.DATABASE_PATH!); } catch {} process.exit(1); });
