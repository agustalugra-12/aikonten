"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

// Halaman balik + layar transfer BCA manual (restyle + theme-aware 2026-10-11, ikut OS).
// LOGIKA TETAP: poll GET /api/account/credits sampai paket aktif. ?bill=&amt=&plan=.
// Belum aktif & ada amt (manual) -> instruksi transfer BCA (tetap poll, auto-flip aktif).
type Kredit = { saldoKredit: number; plan: { nama: string; kreditBulanan: number } | null };
const BANK = { nama: "BCA", rek: "6110330411", an: "Lugra Agusta" };
const rupiah = (n: number) => "Rp " + n.toLocaleString("id-ID");

const CSS = `
.kp-wrap{--bg:#f6f6f3;--bg2:#ffffff;--fg:#0b0b16;--ink:11,11,22;--acc:#4f46e5;--acc2:#6366f1;--cyan:#0e7490;--warn-b:#92400e;--warn-bg:rgba(245,158,11,.1);--warn-br:rgba(245,158,11,.4)}
@media (prefers-color-scheme:dark){.kp-wrap{--bg:#070710;--bg2:#0b0b16;--fg:#fff;--ink:255,255,255;--acc:#a5b4fc;--acc2:#818cf8;--cyan:#22d3ee;--warn-b:#fde68a;--warn-bg:rgba(250,204,21,.08);--warn-br:rgba(250,204,21,.4)}}
.kp-wrap{min-height:100vh;display:flex;align-items:flex-start;justify-content:center;background:var(--bg);color:var(--fg);font-family:var(--font-heading),'Plus Jakarta Sans',system-ui,sans-serif;background-image:radial-gradient(900px 600px at 85% -10%, rgba(99,102,241,.14), transparent 60%);-webkit-font-smoothing:antialiased;padding:clamp(24px,5vw,64px) 20px}
.kp-wrap *{box-sizing:border-box}
.kp-card{width:100%;max-width:520px;border:1px solid rgba(var(--ink),.1);background:var(--bg2);border-radius:24px;padding:clamp(24px,4vw,36px);box-shadow:0 20px 50px rgba(0,0,0,.06)}
.kp-ic{font-size:44px}
.kp-t{margin:10px 0 0;font-size:24px;font-weight:800}
.kp-p{margin:10px 0 0;font-size:15px;line-height:1.6;color:rgba(var(--ink),.7)}
.kp-p b{color:var(--fg)}
.kp-row{display:flex;justify-content:space-between;gap:12px;font-size:14px;padding:10px 0;border-bottom:1px solid rgba(var(--ink),.08)}
.kp-row b{color:var(--fg)}
.kp-bank{margin-top:18px;border-radius:16px;background:var(--bg);border:1px solid rgba(var(--ink),.12);padding:18px;display:flex;flex-direction:column;gap:10px}
.kp-rek{display:flex;align-items:center;gap:12px;justify-content:space-between}
.kp-rek .no{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:24px;font-weight:600;letter-spacing:.04em}
.kp-copy{border:1px solid rgba(var(--ink),.2);background:transparent;color:var(--acc);border-radius:10px;padding:8px 12px;font:inherit;font-size:13px;font-weight:700;cursor:pointer}
.kp-total{display:flex;align-items:baseline;justify-content:space-between;margin-top:16px;border-top:1px solid rgba(var(--ink),.1);padding-top:14px}
.kp-total .v{font-size:28px;font-weight:800}
.kp-warn{margin-top:16px;border:1px solid var(--warn-br);background:var(--warn-bg);color:var(--warn-b);border-radius:12px;padding:12px 16px;font-size:13px;line-height:1.6}
.kp-btn{display:block;width:100%;text-align:center;margin-top:20px;border:0;cursor:pointer;font-family:inherit;background:#6366f1;color:#fff;border-radius:999px;padding:15px;font-weight:800;font-size:16px}
.kp-btn.ghost{background:transparent;border:1px solid rgba(var(--ink),.2);color:var(--fg);margin-top:10px}
.kp-steps{margin:14px 0 0;padding-left:20px;font-size:14px;line-height:1.9;color:rgba(var(--ink),.72)}
`;

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const amt = Number(sp.get("amt") || 0);
  const plan = sp.get("plan") || "";
  const bill = sp.get("bill") || "";
  const [data, setData] = useState<Kredit | null>(null);
  const [selesai, setSelesai] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let batal = false; let coba = 0;
    async function cek() {
      coba++;
      try {
        const d: Kredit = await fetch("/api/account/credits").then((r) => r.json());
        if (batal) return;
        setData(d);
        if (d.plan) { setSelesai(true); return; }
      } catch { /* ulang */ }
      if (!batal) setTimeout(cek, coba < 8 ? 2500 : 6000);
    }
    cek();
    return () => { batal = true; };
  }, []);

  const aktif = !!data?.plan;
  const manual = !aktif && amt > 0;

  if (aktif) {
    return (
      <div className="kp-card" style={{ textAlign: "center" }}>
        <div className="kp-ic">✅</div>
        <h1 className="kp-t">Pembayaran dikonfirmasi!</h1>
        <p className="kp-p">
          Paket <b style={{ textTransform: "capitalize" }}>{data!.plan!.nama}</b> sudah aktif.
          Saldo kamu <b>{data!.saldoKredit} kredit</b>. Selamat membuat konten!
        </p>
        <button className="kp-btn" onClick={() => { router.push("/onboarding"); router.refresh(); }}>Lanjut: setup akun →</button>
      </div>
    );
  }

  if (manual) {
    return (
      <div className="kp-card">
        <div className="kp-ic">🧾</div>
        <h1 className="kp-t">Selesaikan pembayaran</h1>
        <p className="kp-p">Transfer sesuai nominal di bawah ke rekening berikut. Paket otomatis aktif setelah pembayaran kami konfirmasi (maks. 1×24 jam kerja).</p>

        <div className="kp-bank">
          <div style={{ fontSize: 13, color: "rgba(var(--ink),.6)" }}>Transfer ke Bank {BANK.nama}</div>
          <div className="kp-rek">
            <span className="no">{BANK.rek}</span>
            <button className="kp-copy" onClick={() => { navigator.clipboard?.writeText(BANK.rek); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
              {copied ? "Tersalin ✓" : "Salin"}
            </button>
          </div>
          <div style={{ fontSize: 14 }}>a.n. <b>{BANK.an}</b></div>
        </div>

        <div className="kp-total">
          <span style={{ color: "rgba(var(--ink),.65)", fontSize: 14 }}>Total transfer</span>
          <span className="v">{rupiah(amt)}</span>
        </div>
        <div className="kp-row" style={{ borderBottom: "none" }}>
          <span style={{ color: "rgba(var(--ink),.6)" }}>Paket</span>
          <b style={{ textTransform: "capitalize" }}>{plan}</b>
        </div>
        <div className="kp-row">
          <span style={{ color: "rgba(var(--ink),.6)" }}>No. pesanan</span>
          <b style={{ fontFamily: "ui-monospace,monospace" }}>{bill}</b>
        </div>

        <ol className="kp-steps">
          <li>Transfer <b>{rupiah(amt)}</b> ke BCA {BANK.rek} a.n. {BANK.an}.</li>
          <li>Simpan bukti transfer.</li>
          <li>Konfirmasi lewat WhatsApp <a href={`https://wa.me/6287761611631?text=${encodeURIComponent(`Halo, saya sudah transfer paket ${plan} (${rupiah(amt)}), no pesanan ${bill}.`)}`} style={{ color: "var(--acc)" }}>0877-6161-1631</a> + lampirkan bukti.</li>
        </ol>

        <div className="kp-warn">Halaman ini akan otomatis berubah jadi “aktif” begitu pembayaran dikonfirmasi — tak perlu ditutup. Kamu juga bisa cek nanti di dashboard.</div>
        <button className="kp-btn ghost" onClick={() => { router.push("/"); router.refresh(); }}>Nanti dulu, ke dashboard</button>
      </div>
    );
  }

  return (
    <div className="kp-card" style={{ textAlign: "center" }}>
      <div className="kp-ic">{selesai ? "🕐" : "⏳"}</div>
      <h1 className="kp-t">{selesai ? "Menunggu konfirmasi" : "Mengecek pembayaran…"}</h1>
      <p className="kp-p">
        {selesai
          ? "Pembayaran kamu sedang diproses. Begitu lunas/dikonfirmasi, paket aktif otomatis. Muat ulang halaman ini atau cek dashboard nanti."
          : "Sebentar ya…"}
      </p>
      <Link href="/" className="kp-btn" style={{ textDecoration: "none" }}>Ke dashboard</Link>
    </div>
  );
}

export default function SuksesPage() {
  return (
    <div className="kp-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <Suspense fallback={<div className="kp-card" style={{ textAlign: "center" }}><div className="kp-ic">⏳</div><p className="kp-p">Memuat…</p></div>}>
        <Inner />
      </Suspense>
    </div>
  );
}
