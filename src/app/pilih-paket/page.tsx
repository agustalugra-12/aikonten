"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

// Halaman pilih paket (restyle + theme-aware 2026-10-11, ikut OS). LOGIKA & KONTRAK TETAP:
// GET /api/plans, POST /api/account/select-plan { planId }. paymentUrl(Duitku)->redirect;
// pending(manual)-> /pilih-paket/sukses?bill=&amt=&plan= (layar transfer BCA).
type Plan = {
  id: string; nama: string; kreditBulanan: number; hargaBulananIdr: number;
  izinAutoPosting: boolean; maxBrand: number;
};
const SITE = "https://agustapstudio.com";
const rupiah = (n: number) => "Rp " + n.toLocaleString("id-ID");

const CSS = `
.kp-wrap{--bg:#f6f6f3;--bg2:#ffffff;--fg:#0b0b16;--ink:11,11,22;--acc-soft:#4338ca;--acc:#4f46e5;--acc2:#6366f1;--cyan:#0e7490}
@media (prefers-color-scheme:dark){.kp-wrap{--bg:#070710;--bg2:#0b0b16;--fg:#fff;--ink:255,255,255;--acc-soft:#c7d2fe;--acc:#a5b4fc;--acc2:#818cf8;--cyan:#22d3ee}}
.kp-wrap{min-height:100vh;display:flex;flex-direction:column;background:var(--bg);color:var(--fg);font-family:var(--font-heading),'Plus Jakarta Sans',system-ui,sans-serif;background-image:radial-gradient(900px 600px at 85% -10%, rgba(99,102,241,.14), transparent 60%);-webkit-font-smoothing:antialiased}
.kp-wrap *{box-sizing:border-box}
.kp-wrap a{color:var(--acc);text-decoration:none}.kp-wrap a:hover{color:var(--fg)}
.kp-head{border-bottom:1px solid rgba(var(--ink),.08)}
.kp-nav{max-width:1200px;margin:0 auto;padding:14px clamp(20px,4vw,40px);display:flex;align-items:center;justify-content:space-between;gap:12px 20px;flex-wrap:wrap}
.kp-logo{display:flex;align-items:center;gap:10px;color:var(--fg)}
.kp-logo img{width:34px;height:34px;border-radius:9px;object-fit:cover}
.kp-logo b{font-weight:800;font-size:16px}
.kp-main{flex:1;width:100%;max-width:1100px;margin:0 auto;padding:clamp(32px,6vw,72px) clamp(20px,4vw,40px)}
.kp-eyebrow{font-size:12px;font-weight:700;letter-spacing:.16em;color:var(--acc-soft)}
.kp-h1{margin:12px 0 0;font-size:clamp(28px,4vw,44px);line-height:1.08;letter-spacing:-.03em;font-weight:800}
.kp-sub{margin:12px 0 0;font-size:16px;line-height:1.6;color:rgba(var(--ink),.68)}
.kp-grid{margin-top:40px;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;align-items:stretch}
.kp-plan{border:1px solid rgba(var(--ink),.1);background:var(--bg2);border-radius:24px;padding:30px;display:flex;flex-direction:column;position:relative;box-shadow:0 14px 40px rgba(0,0,0,.05)}
.kp-plan.pop{border:1px solid rgba(99,102,241,.6);background:linear-gradient(180deg,rgba(99,102,241,.14),var(--bg2));box-shadow:0 30px 60px rgba(49,46,129,.22)}
.kp-tag{position:absolute;top:-13px;left:30px;background:#6366f1;color:#fff;font-size:11px;font-weight:800;letter-spacing:.1em;border-radius:999px;padding:6px 12px}
.kp-pname{font-size:13px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:rgba(var(--ink),.6)}
.kp-plan.pop .kp-pname{color:var(--acc-soft)}
.kp-price{margin-top:16px;font-size:36px;font-weight:800;letter-spacing:-.03em}
.kp-price small{font-size:14px;font-weight:600;color:rgba(var(--ink),.5)}
.kp-feats{margin-top:20px;display:flex;flex-direction:column;gap:11px;font-size:15px;color:rgba(var(--ink),.82);flex:1}
.kp-btn{margin-top:26px;text-align:center;border:0;cursor:pointer;font-family:inherit;border-radius:999px;padding:14px;font-weight:700;font-size:15px}
.kp-btn.primary{background:#6366f1;color:#fff}
.kp-btn.ghost{border:1px solid rgba(var(--ink),.2);background:transparent;color:var(--fg)}
.kp-btn:disabled{opacity:.6;cursor:default}
.kp-note{margin-top:28px;text-align:center;font-size:14px;color:rgba(var(--ink),.55)}
`;

export default function PilihPaketPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [prosesId, setProsesId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/plans")
      .then((r) => r.json())
      .then((rows: Plan[]) => setPlans([...rows].sort((a, b) => a.hargaBulananIdr - b.hargaBulananIdr)))
      .catch(() => toast.error("Gagal memuat daftar paket"))
      .finally(() => setLoading(false));
  }, []);

  async function pilih(plan: Plan) {
    setProsesId(plan.id);
    try {
      const res = await fetch("/api/account/select-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "Gagal memproses pilihan paket"); return; }
      if (data.paymentUrl) { window.location.href = data.paymentUrl; return; }
      const amt = data.jumlahBayarIdr ?? plan.hargaBulananIdr;
      router.push(`/pilih-paket/sukses?bill=${data.billingLogId}&amt=${amt}&plan=${encodeURIComponent(plan.nama)}`);
    } catch {
      toast.error("Terjadi kesalahan. Coba lagi.");
    } finally {
      setProsesId(null);
    }
  }

  return (
    <div className="kp-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <header className="kp-head">
        <nav className="kp-nav">
          <a href={SITE} className="kp-logo"><img src="https://agustapstudio.com/assets/export/logo-agustap.png" alt="KontenPilot" /><b>KontenPilot</b></a>
          <span style={{ fontSize: 13, color: "rgba(var(--ink),.55)" }}>Langkah 2 dari 2 · Pilih paket</span>
        </nav>
      </header>

      <main className="kp-main">
        <div style={{ maxWidth: 640 }}>
          <span className="kp-eyebrow">PILIH PAKET</span>
          <h1 className="kp-h1">Pilih paket, mulai hari ini.</h1>
          <p className="kp-sub">Setiap konten (foto / video / carousel) = 1 kredit. Tanpa kontrak, bisa upgrade kapan saja.</p>
        </div>

        {loading ? (
          <p style={{ marginTop: 40, color: "rgba(var(--ink),.6)" }}>Memuat paket…</p>
        ) : (
          <div className="kp-grid">
            {plans.map((p) => {
              const pop = p.nama.toLowerCase() === "pro";
              return (
                <div key={p.id} className={pop ? "kp-plan pop" : "kp-plan"}>
                  {pop && <span className="kp-tag">PALING POPULER</span>}
                  <div className="kp-pname">{p.nama}</div>
                  <div className="kp-price">{rupiah(p.hargaBulananIdr)}<small> /bulan</small></div>
                  <div className="kp-feats">
                    <span>✓ {p.kreditBulanan} konten / bulan</span>
                    <span>✓ {p.izinAutoPosting ? "Auto-post ke sosial media" : "Download konten (tanpa auto-post)"}</span>
                    <span>✓ {p.maxBrand} brand</span>
                    <span>✓ Analitik &amp; laporan performa</span>
                  </div>
                  <button className={pop ? "kp-btn primary" : "kp-btn ghost"} disabled={prosesId !== null} onClick={() => pilih(p)}>
                    {prosesId === p.id ? "Memproses…" : "Pilih paket ini"}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <p className="kp-note">Pembayaran via transfer bank, dikonfirmasi manual (pembayaran otomatis via gateway menyusul).</p>
      </main>
    </div>
  );
}
