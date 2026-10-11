"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

// Halaman balik setelah pilih paket (restyle 2026-10-11 + layar transfer BCA manual).
// LOGIKA TETAP: poll GET /api/account/credits sampai paket aktif (aktivasi terjadi via
// webhook Duitku ATAU konfirmasi manual admin -> aktivasiPaketSetelahBayar). Query:
// ?bill=<billingLogId>&amt=<nominal>&plan=<nama>. Kalau paket belum aktif & ada amt
// (jalur transfer manual) -> tampilkan instruksi transfer BCA + nominal + order id,
// TETAP poll (auto-flip ke "aktif" begitu Agus konfirmasi). Tanpa amt (return Duitku) ->
// pesan menunggu generik.
type Kredit = { saldoKredit: number; plan: { nama: string; kreditBulanan: number } | null };

const BANK = { nama: "BCA", rek: "6110330411", an: "Lugra Agusta" };
const rupiah = (n: number) => "Rp " + n.toLocaleString("id-ID");

const CSS = `
.kp-wrap{--bg:#070710;--bg2:#0b0b16;--fg:#fff;--ink:255,255,255;--acc-soft:#c7d2fe;--acc:#a5b4fc;--acc2:#818cf8;--cyan:#22d3ee;--warn:#fde68a;min-height:100vh;display:flex;align-items:flex-start;justify-content:center;background:var(--bg);color:var(--fg);font-family:var(--font-heading),'Plus Jakarta Sans',system-ui,sans-serif;background-image:radial-gradient(900px 600px at 85% -10%, rgba(99,102,241,.14), transparent 60%);-webkit-font-smoothing:antialiased;padding:clamp(24px,5vw,64px) 20px}
.kp-wrap *{box-sizing:border-box}
.kp-card{width:100%;max-width:520px;border:1px solid rgba(var(--ink),.1);background:rgba(var(--ink),.03);border-radius:24px;padding:clamp(24px,4vw,36px)}
.kp-ic{font-size:44px}
.kp-t{margin:10px 0 0;font-size:24px;font-weight:800}
.kp-p{margin:10px 0 0;font-size:15px;line-height:1.6;color:rgba(var(--ink),.7)}
.kp-row{display:flex;justify-content:space-between;gap:12px;font-size:14px;padding:10px 0;border-bottom:1px solid rgba(var(--ink),.08)}
.kp-row b{color:#fff}
.kp-bank{margin-top:18px;border-radius:16px;background:var(--bg2);border:1px solid rgba(var(--ink),.12);padding:18px;display:flex;flex-direction:column;gap:10px}
.kp-rek{display:flex;align-items:center;gap:12px;justify-content:space-between}
.kp-rek .no{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:24px;font-weight:600;letter-spacing:.04em}
.kp-copy{border:1px solid rgba(var(--ink),.2);background:transparent;color:var(--acc);border-radius:10px;padding:8px 12px;font:inherit;font-size:13px;font-weight:700;cursor:pointer}
.kp-total{display:flex;align-items:baseline;justify-content:space-between;margin-top:16px;border-top:1px solid rgba(var(--ink),.1);padding-top:14px}
.kp-total .v{font-size:28px;font-weight:800}
.kp-warn{margin-top:16px;border:1px solid rgba(250,204,21,.4);background:rgba(250,204,21,.08);color:var(--warn);border-radius:12px;padding:12px 16px;font-size:13px;line-height:1.6}
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
      if (!batal) setTimeout(cek, coba < 8 ? 2500 : 6000); // poll terus (manual bisa lama)
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
          Paket <b style={{ textTransform: "capitalize", color: "#fff" }}>{data!.plan!.nama}</b> sudah aktif.
          Saldo kamu <b style={{ color: "#fff" }}>{data!.saldoKredit} kredit</b>. Selamat membuat konten!
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
          <div style={{ fontSize: 13, color: "rgba(255,255,255,.6)" }}>Transfer ke Bank {BANK.nama}</div>
          <div className="kp-rek">
            <span className="no">{BANK.rek}</span>
            <button className="kp-copy" onClick={() => { navigator.clipboard?.writeText(BANK.rek); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
              {copied ? "Tersalin ✓" : "Salin"}
            </button>
          </div>
          <div style={{ fontSize: 14 }}>a.n. <b>{BANK.an}</b></div>
        </div>

        <div className="kp-total">
          <span style={{ color: "rgba(255,255,255,.65)", fontSize: 14 }}>Total transfer</span>
          <span className="v">{rupiah(amt)}</span>
        </div>
        <div className="kp-row" style={{ borderBottom: "none" }}>
          <span style={{ color: "rgba(255,255,255,.6)" }}>Paket</span>
          <b style={{ textTransform: "capitalize" }}>{plan}</b>
        </div>
        <div className="kp-row">
          <span style={{ color: "rgba(255,255,255,.6)" }}>No. pesanan</span>
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
