"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Halaman pendaftaran (restyle 2026-10-11; theme-aware 2026-10-11 ikut OS). LOGIKA & KONTRAK
// TETAP: POST /api/auth/signup { email, password, namaBisnis? }, min 8, konfirmasi klien,
// auto-login server -> /pilih-paket. Tampilan: terang default + gelap via prefers-color-scheme,
// semua warna lewat variabel (tidak ada hardcode putih). Logo asli + header -> situs utama.
const SITE = "https://agustapstudio.com";
const CSS = `
.kp-wrap{--bg:#f6f6f3;--bg2:#ffffff;--fg:#0b0b16;--ink:11,11,22;--acc-soft:#4338ca;--acc:#4f46e5;--acc2:#6366f1;--cyan:#0e7490;--err:#b91c1c}
@media (prefers-color-scheme:dark){.kp-wrap{--bg:#070710;--bg2:#0b0b16;--fg:#fff;--ink:255,255,255;--acc-soft:#c7d2fe;--acc:#a5b4fc;--acc2:#818cf8;--cyan:#22d3ee;--err:#fca5a5}}
.kp-wrap{min-height:100vh;display:flex;flex-direction:column;background:var(--bg);color:var(--fg);font-family:var(--font-heading),'Plus Jakarta Sans',system-ui,sans-serif;background-image:radial-gradient(900px 600px at 85% -10%, rgba(99,102,241,.14), transparent 60%);-webkit-font-smoothing:antialiased}
.kp-wrap *{box-sizing:border-box}
.kp-wrap a{color:var(--acc);text-decoration:none}.kp-wrap a:hover{color:var(--fg)}
.kp-head{border-bottom:1px solid rgba(var(--ink),.08)}
.kp-nav{max-width:1200px;margin:0 auto;padding:14px clamp(20px,4vw,40px);display:flex;align-items:center;justify-content:space-between;gap:12px 20px;flex-wrap:wrap}
.kp-logo{display:flex;align-items:center;gap:10px;color:var(--fg)}
.kp-logo img{width:36px;height:36px;border-radius:9px;object-fit:cover}
.kp-logo .wm{display:flex;flex-direction:column;line-height:1.1}
.kp-logo .wm b{font-weight:800;font-size:17px}
.kp-logo .wm s{text-decoration:none;font-size:11px;color:rgba(var(--ink),.5);letter-spacing:.08em}
.kp-main{flex:1;width:100%;max-width:1100px;margin:0 auto;padding:clamp(28px,5vw,64px) clamp(20px,4vw,40px);display:flex;flex-wrap:wrap;gap:clamp(28px,5vw,64px);align-items:flex-start}
.kp-left{flex:1 1 360px;min-width:0;display:flex;flex-direction:column;gap:24px}
.kp-eyebrow{font-size:12px;font-weight:700;letter-spacing:.16em;color:var(--acc-soft)}
.kp-h1{margin:12px 0 0;font-size:clamp(30px,4.4vw,48px);line-height:1.08;letter-spacing:-.03em;font-weight:800}
.kp-lead{margin:14px 0 0;font-size:16px;line-height:1.6;color:rgba(var(--ink),.68);max-width:440px}
.kp-perk{display:flex;gap:12px;align-items:flex-start;font-size:15px;line-height:1.5}
.kp-perk .c{color:var(--cyan);font-weight:800}
.kp-perk span:last-child{color:rgba(var(--ink),.82)}
.kp-testi{border:1px solid rgba(var(--ink),.1);background:rgba(var(--ink),.03);border-radius:20px;padding:22px;display:flex;flex-direction:column;gap:12px}
.kp-testi p{margin:0;font-size:15px;line-height:1.6;color:rgba(var(--ink),.9)}
.kp-testi .by{font-size:13px;color:rgba(var(--ink),.55)}
.kp-testi .by b{color:var(--fg)}
.kp-card{flex:1 1 400px;min-width:0;border:1px solid rgba(var(--ink),.1);background:var(--bg2);border-radius:24px;padding:clamp(22px,3vw,34px);box-shadow:0 20px 50px rgba(0,0,0,.06)}
.kp-card h2{margin:0;font-size:22px;font-weight:800}
.kp-field{display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:600;color:rgba(var(--ink),.78);margin-top:16px}
.kp-field input{background:var(--bg);border:1px solid rgba(var(--ink),.14);border-radius:12px;padding:14px;color:var(--fg);font-size:16px;font-family:inherit;outline:none}
.kp-field input:focus{border-color:var(--acc2)}
.kp-btn{width:100%;margin-top:22px;border:0;cursor:pointer;background:#6366f1;color:#fff;border-radius:999px;padding:16px;font-size:16px;font-weight:800;font-family:inherit;box-shadow:0 12px 32px rgba(99,102,241,.35)}
.kp-btn:disabled{opacity:.6;cursor:default}
.kp-err{margin-top:14px;font-size:14px;color:var(--err)}
.kp-fine{margin-top:14px;font-size:12px;line-height:1.55;color:rgba(var(--ink),.55);text-align:center}
.kp-foot{border-top:1px solid rgba(var(--ink),.08)}
.kp-foot div{max-width:1100px;margin:0 auto;padding:22px clamp(20px,4vw,40px);font-size:13px;color:rgba(var(--ink),.55);display:flex;flex-wrap:wrap;gap:8px 20px;justify-content:space-between}
`;

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [nama, setNama] = useState("");
  const [nomorWa, setNomorWa] = useState("");
  const [namaBisnis, setNamaBisnis] = useState("");
  const [password, setPassword] = useState("");
  const [konfirmasi, setKonfirmasi] = useState("");
  const [setuju, setSetuju] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError("Password minimal 8 karakter"); return; }
    if (password !== konfirmasi) { setError("Konfirmasi password tidak cocok"); return; }
    if (!setuju) { setError("Centang persetujuan Syarat & Ketentuan dulu"); return; }
    setLoading(true);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, namaBisnis, nama, nomorWa, setuju }),
    });
    setLoading(false);
    if (res.ok) { router.push("/pilih-paket"); router.refresh(); }
    else { const data = await res.json().catch(() => ({})); setError(data.error || "Gagal mendaftar"); }
  }

  return (
    <div className="kp-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <header className="kp-head">
        <nav className="kp-nav">
          <a href={SITE} className="kp-logo">
            <img src="https://agustapstudio.com/assets/export/logo-agustap.png" alt="KontenPilot" />
            <span className="wm"><b>KontenPilot</b><s>by Agustap Studio</s></span>
          </a>
          <div style={{ fontSize: 14, color: "rgba(var(--ink),.6)" }}>
            Sudah punya akun? <Link href="/login" style={{ fontWeight: 700 }}>Masuk</Link>
          </div>
        </nav>
      </header>

      <main className="kp-main">
        <section className="kp-left">
          <div>
            <span className="kp-eyebrow">DAFTAR</span>
            <h1 className="kp-h1">Tinggal buat akun, konten kamu tayang besok.</h1>
            <p className="kp-lead">Buat akun dalam 1 menit, pilih paket, lalu atur brand kamu di dashboard.</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              "30 hari konten dibuat otomatis — foto, video, carousel, caption",
              "Auto-post ke Instagram, TikTok, Facebook & YouTube",
              "Tanpa kontrak, berhenti kapan saja",
            ].map((t) => (
              <div key={t} className="kp-perk"><span className="c">✓</span><span>{t}</span></div>
            ))}
          </div>
          <div className="kp-testi">
            <p>“Sangat membantu sekali, apalagi semua serba otomatis — dan terbukti mendatangkan konsumen.”</p>
            <div className="by"><b>Pelangi Homestay</b> · Homestay, Bedugul</div>
          </div>
        </section>

        <section className="kp-card">
          <h2>Buat akun</h2>
          <form onSubmit={handleSubmit}>
            <label className="kp-field">Nama lengkap
              <input value={nama} onChange={(e) => setNama(e.target.value)} autoFocus required placeholder="Nama kamu" autoComplete="name" />
            </label>
            <label className="kp-field">Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="nama@email.com" autoComplete="email" />
            </label>
            <label className="kp-field">No. WhatsApp
              <input type="tel" value={nomorWa} onChange={(e) => setNomorWa(e.target.value)} required placeholder="08xx xxxx xxxx" autoComplete="tel" />
            </label>
            <label className="kp-field">Nama bisnis (opsional)
              <input value={namaBisnis} onChange={(e) => setNamaBisnis(e.target.value)} placeholder="mis. Laundry in Bali" autoComplete="organization" />
            </label>
            <label className="kp-field">Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="Minimal 8 karakter" autoComplete="new-password" />
            </label>
            <label className="kp-field">Ulangi password
              <input type="password" value={konfirmasi} onChange={(e) => setKonfirmasi(e.target.value)} required autoComplete="new-password" />
            </label>
            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 16, fontSize: 13, lineHeight: 1.5, color: "rgba(var(--ink),.72)", cursor: "pointer" }}>
              <input type="checkbox" checked={setuju} onChange={(e) => setSetuju(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, flex: "none", accentColor: "#6366f1" }} />
              <span>Saya setuju dengan <a href="https://agustapstudio.com/situs.html#syarat">Syarat &amp; Ketentuan</a> dan <a href="https://agustapstudio.com/situs.html#privasi">Kebijakan Privasi</a>.</span>
            </label>
            {error && <p className="kp-err">{error}</p>}
            <button type="submit" className="kp-btn" disabled={loading || !setuju}>{loading ? "Mendaftar…" : "Daftar →"}</button>
            <p className="kp-fine">Tanpa kontrak · berhenti kapan saja.</p>
          </form>
        </section>
      </main>

      <footer className="kp-foot">
        <div>
          <span>Butuh bantuan? agus.lugra@gmail.com · 0877-6161-1631</span>
          <span>© 2026 Agustap Studio · KontenPilot</span>
        </div>
      </footer>
    </div>
  );
}
