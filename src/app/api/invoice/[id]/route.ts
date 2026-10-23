import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { billingLog, plans, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getUserId } from "@/lib/session";
import { isAdminEmail } from "@/lib/admin";

// Kwitansi/invoice HTML printable (2026-10-23, #invoice). SENGAJA HTML (bukan lib PDF):
// pelanggan tekan "Unduh/Print" -> browser Save-as-PDF. Akses: pemilik tagihan ATAU admin
// (404 kalau bukan - jangan bocorkan tagihan orang lain). Kwitansi (lunas) vs Tagihan
// (pending). Manual BCA + belum lunas -> tampilkan instruksi transfer.
const MERCHANT = { nama: "Agustap Studio", produk: "KontenPilot", email: "agus.lugra@gmail.com", wa: "0877-6161-1631" };
const BANK = { nama: "BCA", rek: "6110330411", an: "Lugra Agusta" };
const rupiah = (n: number) => "Rp " + Number(n || 0).toLocaleString("id-ID");
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id } = await params;
  const [log] = await db.select().from(billingLog).where(eq(billingLog.id, id));
  if (!log) return new NextResponse("Tagihan tidak ditemukan", { status: 404 });
  if (log.userId !== userId) {
    const [me] = await db.select().from(users).where(eq(users.id, userId));
    if (!me || !isAdminEmail(me.email)) return new NextResponse("Tidak ditemukan", { status: 404 });
  }
  const [pembeli] = await db.select().from(users).where(eq(users.id, log.userId));

  let item = "Pembelian";
  if (log.jenis === "topup") item = `Top-up ${log.kreditTopup ?? 0} kredit`;
  else if (log.planId) {
    const [plan] = await db.select().from(plans).where(eq(plans.id, log.planId));
    item = plan ? `Paket ${plan.nama} — ${plan.kreditBulanan} kredit/bulan` : "Paket langganan";
  }
  const lunas = log.status === "sukses";
  const dibatalkan = log.status === "gagal";
  const d = new Date(log.createdAt);
  const tgl = d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
  const noInv = `INV/${d.getFullYear()}/${esc(log.id.replace(/^bill_/, "").toUpperCase())}`;
  const nmPembeli = esc(pembeli?.namaBisnis || pembeli?.nama || pembeli?.email || "Pelanggan");
  const judul = lunas ? "KWITANSI" : dibatalkan ? "TAGIHAN (BATAL)" : "TAGIHAN";
  const statusTxt = lunas ? "LUNAS" : dibatalkan ? "DIBATALKAN" : "MENUNGGU PEMBAYARAN";
  const statusColor = lunas ? "#047857" : dibatalkan ? "#b91c1c" : "#b45309";
  const manualPending = !lunas && !dibatalkan && !log.gatewayRef;

  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${judul} ${noInv}</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Plus Jakarta Sans',system-ui,-apple-system,sans-serif;color:#0b0b16;background:#f3f4f6;padding:24px;line-height:1.5}
.sheet{max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:40px}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
.brand b{font-size:20px;font-weight:800}.brand div{font-size:13px;color:#6b7280;margin-top:2px}
.doc{text-align:right}.doc .j{font-size:22px;font-weight:800;letter-spacing:.05em}.doc .n{font-size:13px;color:#6b7280;margin-top:4px}
.badge{display:inline-block;margin-top:8px;font-size:12px;font-weight:800;letter-spacing:.06em;padding:4px 10px;border-radius:999px;color:#fff;background:${statusColor}}
.meta{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;margin:28px 0;font-size:14px}
.meta .lbl{font-size:11px;font-weight:700;letter-spacing:.1em;color:#9ca3af;text-transform:uppercase;margin-bottom:4px}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:14px}
th{text-align:left;font-size:11px;letter-spacing:.08em;color:#9ca3af;text-transform:uppercase;border-bottom:2px solid #e5e7eb;padding:10px 0}
td{padding:14px 0;border-bottom:1px solid #f0f0f0}.r{text-align:right}
.total{display:flex;justify-content:space-between;align-items:baseline;margin-top:20px;padding-top:16px;border-top:2px solid #0b0b16}
.total .v{font-size:26px;font-weight:800}
.bank{margin-top:24px;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px;font-size:14px}
.bank .no{font-family:ui-monospace,monospace;font-size:20px;font-weight:700}
.foot{margin-top:32px;text-align:center;font-size:12px;color:#9ca3af}
.actions{max-width:640px;margin:16px auto 0;text-align:center}
.btn{border:0;background:#6366f1;color:#fff;border-radius:999px;padding:12px 28px;font:inherit;font-weight:700;cursor:pointer}
@media print{body{background:#fff;padding:0}.sheet{border:0;border-radius:0}.actions{display:none}}
</style></head><body>
<div class="sheet">
  <div class="top">
    <div class="brand"><b>${MERCHANT.produk}</b><div>oleh ${MERCHANT.nama}</div><div>${MERCHANT.email} · ${MERCHANT.wa}</div></div>
    <div class="doc"><div class="j">${judul}</div><div class="n">${noInv}</div><span class="badge">${statusTxt}</span></div>
  </div>
  <div class="meta">
    <div><div class="lbl">Ditagihkan kepada</div><div><b>${nmPembeli}</b></div><div>${esc(pembeli?.email || "")}</div>${pembeli?.nomorWa ? `<div>WA ${esc(pembeli.nomorWa)}</div>` : ""}</div>
    <div style="text-align:right"><div class="lbl">Tanggal</div><div>${tgl}</div>${log.gatewayRef ? `<div class="lbl" style="margin-top:10px">Ref Pembayaran</div><div>${esc(log.gatewayRef)}</div>` : ""}</div>
  </div>
  <table><thead><tr><th>Deskripsi</th><th class="r">Jumlah</th></tr></thead>
    <tbody><tr><td>${esc(item)}</td><td class="r">${rupiah(log.jumlahBayarIdr)}</td></tr></tbody></table>
  <div class="total"><span>Total</span><span class="v">${rupiah(log.jumlahBayarIdr)}</span></div>
  ${manualPending ? `<div class="bank"><b>Cara bayar — transfer ${BANK.nama}</b><div class="no">${BANK.rek}</div><div>a.n. ${BANK.an} · nominal <b>${rupiah(log.jumlahBayarIdr)}</b></div><div style="margin-top:6px;color:#92400e">Paket aktif otomatis setelah pembayaran dikonfirmasi.</div></div>` : ""}
  <div class="foot">Terima kasih telah menggunakan ${MERCHANT.produk}. Dokumen ini sah tanpa tanda tangan.</div>
</div>
<div class="actions"><button class="btn" onclick="window.print()">Unduh / Print PDF</button></div>
</body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
