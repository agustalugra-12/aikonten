"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { TOPUP_PACKS } from "@/lib/billing/topupPacks";

// Halaman kredit & top-up (restyle + theme-aware 2026-10-11, ikut OS). LOGIKA & KONTRAK TETAP:
// GET /api/account/credits; POST /api/account/topup { packId }; POST /api/account/cancel { resume }.
type Riwayat = { jumlah: number; alasan: string; saldoSetelah: number; createdAt: string };
type Kredit = {
  saldoKredit: number;
  status: string;
  periodeBerakhir: string | null;
  langgananDibatalkan: boolean;
  plan: { nama: string; kreditBulanan: number } | null;
  riwayat: Riwayat[];
};
const LOGO = "https://agustapstudio.com/assets/export/logo-agustap.png";
const rupiah = (n: number) => "Rp " + n.toLocaleString("id-ID");
const tanggal = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—";
const STATUS_LANGGANAN: Record<string, { label: string; warna: string }> = {
  aktif: { label: "Aktif", warna: "#22c55e" },
  masa_tenggang: { label: "Masa tenggang", warna: "#f59e0b" },
  terbatas: { label: "Terbatas (perpanjang paket)", warna: "#ef4444" },
};

const CSS = `
.kp-wrap{--bg:#f6f6f3;--bg2:#ffffff;--fg:#0b0b16;--ink:11,11,22;--acc:#4f46e5;--acc2:#6366f1;--acc-soft:#4338ca;--cyan:#0e7490}
@media (prefers-color-scheme:dark){.kp-wrap{--bg:#070710;--bg2:#0b0b16;--fg:#fff;--ink:255,255,255;--acc:#a5b4fc;--acc2:#818cf8;--acc-soft:#c7d2fe;--cyan:#22d3ee}}
.kp-wrap{min-height:100vh;background:var(--bg);color:var(--fg);font-family:var(--font-heading),'Plus Jakarta Sans',system-ui,sans-serif;background-image:radial-gradient(900px 600px at 85% -10%, rgba(99,102,241,.14), transparent 60%);-webkit-font-smoothing:antialiased}
.kp-wrap *{box-sizing:border-box}
.kp-wrap a{color:var(--acc);text-decoration:none}.kp-wrap a:hover{color:var(--fg)}
.kp-head{border-bottom:1px solid rgba(var(--ink),.08)}
.kp-nav{max-width:1000px;margin:0 auto;padding:14px clamp(20px,4vw,40px);display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.kp-logo{display:flex;align-items:center;gap:10px;color:var(--fg)}
.kp-logo img{width:32px;height:32px;border-radius:8px;object-fit:cover}
.kp-logo b{font-weight:800;font-size:16px}
.kp-main{max-width:1000px;margin:0 auto;padding:clamp(24px,4vw,40px) clamp(20px,4vw,40px);display:flex;flex-direction:column;gap:28px}
.kp-card{border:1px solid rgba(var(--ink),.1);background:var(--bg2);border-radius:20px;padding:26px;box-shadow:0 14px 40px rgba(0,0,0,.05)}
.kp-saldo{display:flex;flex-wrap:wrap;gap:24px;align-items:flex-end;justify-content:space-between}
.kp-saldo .big{font-size:48px;font-weight:800;letter-spacing:-.03em;line-height:1}
.kp-badge{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:700;padding:6px 12px;border-radius:999px;background:rgba(var(--ink),.06)}
.kp-dot{width:8px;height:8px;border-radius:50%}
.kp-meta{display:flex;flex-wrap:wrap;gap:6px 24px;margin-top:16px;font-size:14px;color:rgba(var(--ink),.6)}
.kp-meta b{color:var(--fg)}
.kp-h2{font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:rgba(var(--ink),.5);margin:0 0 14px}
.kp-btn{border:0;cursor:pointer;font-family:inherit;border-radius:999px;padding:12px 20px;font-weight:700;font-size:14px}
.kp-btn.primary{background:#6366f1;color:#fff}
.kp-btn.ghost{border:1px solid rgba(var(--ink),.2);background:transparent;color:var(--fg)}
.kp-btn:disabled{opacity:.6;cursor:default}
.kp-topup{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
.kp-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:20px;z-index:50}
.kp-modal{background:var(--bg2);border:1px solid rgba(var(--ink),.12);border-radius:20px;padding:24px;max-width:420px;width:100%;max-height:85vh;overflow:auto}
.kp-modal-h{font-size:18px;font-weight:800}
.kp-modal-sub{margin-top:4px;font-size:14px;color:rgba(var(--ink),.6)}
.kp-methods{margin:18px 0;display:flex;flex-direction:column;gap:8px}
.kp-method{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid rgba(var(--ink),.14);background:var(--bg);border-radius:12px;cursor:pointer;font-family:inherit;font-size:15px;color:var(--fg);text-align:left}
.kp-method:hover{border-color:var(--acc2)}
.kp-method img{width:36px;height:24px;object-fit:contain}
.kp-method span{flex:1}
.kp-method small{color:rgba(var(--ink),.5);font-size:12px}
.kp-method:disabled{opacity:.6;cursor:default}
.kp-pack{border:1px solid rgba(var(--ink),.1);background:var(--bg2);border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:6px}
.kp-pack .nm{font-size:16px;font-weight:800}
.kp-pack .hg{font-size:22px;font-weight:800}
.kp-pack .kr{font-size:13px;color:rgba(var(--ink),.6)}
table.kp-tbl{width:100%;border-collapse:collapse;font-size:14px}
table.kp-tbl th{text-align:left;color:rgba(var(--ink),.5);font-weight:600;padding:12px 14px;border-bottom:1px solid rgba(var(--ink),.1)}
table.kp-tbl td{padding:12px 14px;border-bottom:1px solid rgba(var(--ink),.06)}
.kp-r{text-align:right;font-variant-numeric:tabular-nums}
.kp-muted{min-height:100vh;display:grid;place-items:center;background:var(--bg);color:rgba(var(--ink),.6);font-family:var(--font-heading),system-ui}
`;

export default function KreditPage() {
  const router = useRouter();
  const [data, setData] = useState<Kredit | null>(null);
  const [loading, setLoading] = useState(true);
  const [beli, setBeli] = useState<string | null>(null);
  const [packDipilih, setPackDipilih] = useState<(typeof TOPUP_PACKS)[number] | null>(null);
  const [metode, setMetode] = useState<{ paymentMethod: string; paymentName: string; paymentImage: string; totalFee: string }[]>([]);
  const [aksi, setAksi] = useState(false);

  async function muat() {
    try {
      const d: Kredit = await fetch("/api/account/credits").then((r) => r.json());
      setData(d);
    } catch {
      toast.error("Gagal memuat data kredit");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { muat(); }, []);

  // Langkah 1: cek metode bayar gateway. Ada -> modal pilih metode. Kosong -> fallback manual BCA.
  async function pilihTopup(pack: (typeof TOPUP_PACKS)[number]) {
    setBeli(pack.id);
    try {
      const res = await fetch(`/api/account/payment-methods?amount=${pack.hargaIdr}`);
      const d = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(d.methods) && d.methods.length > 0) {
        setMetode(d.methods); setPackDipilih(pack); return;
      }
      await bayarTopup(pack, null);
    } catch {
      toast.error("Terjadi kesalahan. Coba lagi.");
    } finally {
      setBeli(null);
    }
  }

  // Langkah 2: buat transaksi top-up. paymentMethod null = jalur manual BCA.
  async function bayarTopup(pack: (typeof TOPUP_PACKS)[number], paymentMethod: string | null) {
    setBeli(pack.id);
    try {
      const res = await fetch("/api/account/topup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(paymentMethod ? { packId: pack.id, paymentMethod } : { packId: pack.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "Gagal memproses top-up"); return; }
      if (d.paymentUrl) { window.location.href = d.paymentUrl; return; }
      toast.success("Top-up dipilih. Menunggu konfirmasi pembayaran.");
      await muat();
    } catch {
      toast.error("Terjadi kesalahan. Coba lagi.");
    } finally {
      setBeli(null); setPackDipilih(null);
    }
  }

  async function ubahBatal(resume: boolean) {
    if (!resume && !confirm("Batalkan langganan? Akses TETAP sampai akhir periode, hanya tidak akan diperpanjang.")) return;
    setAksi(true);
    try {
      const res = await fetch("/api/account/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resume }) });
      if (!res.ok) throw new Error();
      await muat();
      toast.success(resume ? "Langganan dilanjutkan." : "Langganan dibatalkan - aktif sampai akhir periode.");
    } catch {
      toast.error("Gagal memproses. Coba lagi.");
    } finally {
      setAksi(false);
    }
  }

  if (loading || !data) {
    return (<><style dangerouslySetInnerHTML={{ __html: CSS }} /><div className="kp-muted">Memuat kredit…</div></>);
  }

  const st = STATUS_LANGGANAN[data.status] ?? { label: data.status, warna: "#818cf8" };

  return (
    <div className="kp-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <header className="kp-head">
        <nav className="kp-nav">
          <Link href="/" className="kp-logo"><img src={LOGO} alt="KontenPilot" /><b>KontenPilot</b></Link>
          <Link href="/" className="kp-btn ghost" style={{ textDecoration: "none" }}>← Dashboard</Link>
        </nav>
      </header>

      <main className="kp-main">
        <h1 style={{ margin: 0, fontSize: "clamp(24px,3.4vw,34px)", fontWeight: 800, letterSpacing: "-.02em" }}>Kredit &amp; Langganan</h1>

        <div className="kp-card">
          <div className="kp-saldo">
            <div>
              <div style={{ fontSize: 13, color: "rgba(var(--ink),.55)" }}>Saldo kredit</div>
              <div className="big">{data.saldoKredit}<span style={{ fontSize: 18, fontWeight: 600, color: "rgba(var(--ink),.5)" }}> kredit</span></div>
            </div>
            <span className="kp-badge"><span className="kp-dot" style={{ background: st.warna }} />{st.label}</span>
          </div>
          <div className="kp-meta">
            <span>Paket: <b style={{ textTransform: "capitalize" }}>{data.plan?.nama ?? "—"}</b></span>
            <span>Kuota bulanan: <b>{data.plan?.kreditBulanan ?? 0}</b></span>
            <span>Berlaku s/d: <b>{tanggal(data.periodeBerakhir)}</b></span>
          </div>
          <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button className="kp-btn primary" onClick={() => router.push("/pilih-paket")}>Perpanjang / ubah paket</button>
            {data.langgananDibatalkan ? (
              <>
                <span style={{ fontSize: 13, color: "rgba(var(--ink),.55)" }}>Dibatalkan — akses sampai {tanggal(data.periodeBerakhir)}.</span>
                <button className="kp-btn ghost" disabled={aksi} onClick={() => ubahBatal(true)}>Lanjutkan langganan</button>
              </>
            ) : (
              <button className="kp-btn ghost" disabled={aksi} onClick={() => ubahBatal(false)}>Batalkan langganan</button>
            )}
          </div>
        </div>

        <div>
          <h2 className="kp-h2">Top-up kredit</h2>
          <div className="kp-topup">
            {TOPUP_PACKS.map((p) => (
              <div key={p.id} className="kp-pack">
                <div className="nm">{p.nama}</div>
                <div className="hg">{rupiah(p.hargaIdr)}</div>
                <div className="kr">+{p.kredit} kredit langsung masuk</div>
                <button className="kp-btn ghost" style={{ marginTop: 8 }} disabled={beli !== null} onClick={() => pilihTopup(p)}>
                  {beli === p.id ? "Memproses…" : "Beli"}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="kp-h2">Riwayat kredit (20 terakhir)</h2>
          <div className="kp-card" style={{ padding: 0, overflowX: "auto" }}>
            <table className="kp-tbl">
              <thead>
                <tr><th>Tanggal</th><th>Keterangan</th><th className="kp-r">Jumlah</th><th className="kp-r">Saldo</th></tr>
              </thead>
              <tbody>
                {data.riwayat.map((r, i) => (
                  <tr key={i}>
                    <td>{tanggal(r.createdAt)}</td>
                    <td>{r.alasan}</td>
                    <td className="kp-r" style={{ color: r.jumlah < 0 ? "#ef4444" : "#16a34a" }}>{r.jumlah > 0 ? `+${r.jumlah}` : r.jumlah}</td>
                    <td className="kp-r">{r.saldoSetelah}</td>
                  </tr>
                ))}
                {data.riwayat.length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: "center", color: "rgba(var(--ink),.5)", padding: "32px 0" }}>Belum ada transaksi kredit.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      {packDipilih && (
        <div className="kp-modal-bg" onClick={() => { setPackDipilih(null); setBeli(null); }}>
          <div className="kp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="kp-modal-h">Pilih metode pembayaran</div>
            <div className="kp-modal-sub">{packDipilih.nama} · {rupiah(packDipilih.hargaIdr)}</div>
            <div className="kp-methods">
              {metode.map((m) => (
                <button key={m.paymentMethod} className="kp-method" disabled={beli !== null}
                  onClick={() => bayarTopup(packDipilih, m.paymentMethod)}>
                  <img src={m.paymentImage} alt="" />
                  <span>{m.paymentName}</span>
                  {Number(m.totalFee) > 0 && <small>+{rupiah(Number(m.totalFee))}</small>}
                </button>
              ))}
            </div>
            <button className="kp-btn ghost" onClick={() => { setPackDipilih(null); setBeli(null); }}>Batal</button>
          </div>
        </div>
      )}
      </main>
    </div>
  );
}
