"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Halaman pendaftaran (restyle 2026-10-11 sesuai desain KontenPilot gelap - sebelumnya
// shadcn polos). LOGIKA & KONTRAK TETAP: POST /api/auth/signup { email, password,
// namaBisnis? }, password min 8, konfirmasi dicek klien, auto-login server, lalu ke
// /pilih-paket. Hanya tampilan yang diganti (dark + indigo, 2 kolom). Tidak ada "Daftar
// dengan Google" - backend memang email-only.
const CSS = `
.kp-wrap{--bg:#070710;--bg2:#0b0b16;--fg:#fff;--ink:255,255,255;--acc-soft:#c7d2fe;--acc:#a5b4fc;--acc2:#818cf8;--cyan:#22d3ee;--err:#fca5a5;min-height:100vh;display:flex;flex-direction:column;background:var(--bg);color:var(--fg);font-family:var(--font-heading),'Plus Jakarta Sans',system-ui,sans-serif;background-image:radial-gradient(900px 600px at 85% -10%, rgba(99,102,241,.14), transparent 60%);-webkit-font-smoothing:antialiased}
.kp-wrap *{box-sizing:border-box}
.kp-wrap a{color:var(--acc);text-decoration:none}.kp-wrap a:hover{color:var(--fg)}
.kp-head{border-bottom:1px solid rgba(var(--ink),.08)}
.kp-nav{max-width:1200px;margin:0 auto;padding:14px clamp(20px,4vw,40px);display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.kp-logo{display:flex;align-items:center;gap:10px;color:var(--fg)}
.kp-logo .mk{width:34px;height:34px;border-radius:9px;background:#6366f1;display:grid;place-items:center;font-weight:800;font-size:16px}
.kp-main{flex:1;width:100%;max-width:1100px;margin:0 auto;padding:clamp(28px,5vw,64px) clamp(20px,4vw,40px);display:flex;flex-wrap:wrap;gap:clamp(28px,5vw,64px);align-items:flex-start}
.kp-left{flex:1 1 360px;min-width:0;display:flex;flex-direction:column;gap:24px}
.kp-eyebrow{font-size:12px;font-weight:700;letter-spacing:.16em;color:var(--acc-soft)}
.kp-h1{margin:12px 0 0;font-size:clamp(30px,4.4vw,48px);line-height:1.08;letter-spacing:-.03em;font-weight:800}
.kp-lead{margin:14px 0 0;font-size:16px;line-height:1.6;color:rgba(var(--ink),.68);max-width:440px}
.kp-perk{display:flex;gap:12px;align-items:flex-start;font-size:15px;line-height:1.5}
.kp-perk .c{color:var(--cyan);font-weight:800}
.kp-perk span:last-child{color:rgba(var(--ink),.82)}
.kp-testi{border:1px solid rgba(var(--ink),.1);background:rgba(var(--ink),.03);border-radius:20px;padding:22px;display:flex;flex-direction:column;gap:12px}
.kp-card{flex:1 1 400px;min-width:0;border:1px solid rgba(var(--ink),.1);background:rgba(var(--ink),.03);border-radius:24px;padding:clamp(22px,3vw,34px)}
.kp-card h2{margin:0;font-size:22px;font-weight:800}
.kp-field{display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:600;color:rgba(var(--ink),.78);margin-top:16px}
.kp-field input{background:var(--bg2);border:1px solid rgba(var(--ink),.14);border-radius:12px;padding:14px;color:var(--fg);font-size:16px;font-family:inherit;outline:none}
.kp-field input:focus{border-color:var(--acc2)}
.kp-btn{width:100%;margin-top:22px;border:0;cursor:pointer;background:#6366f1;color:#fff;border-radius:999px;padding:16px;font-size:16px;font-weight:800;font-family:inherit;box-shadow:0 12px 32px rgba(99,102,241,.35)}
.kp-btn:disabled{opacity:.6;cursor:default}
.kp-err{margin-top:14px;font-size:14px;color:var(--err)}
.kp-foot{border-top:1px solid rgba(var(--ink),.08)}
.kp-foot div{max-width:1100px;margin:0 auto;padding:22px clamp(20px,4vw,40px);font-size:13px;color:rgba(var(--ink),.55);display:flex;flex-wrap:wrap;gap:8px 20px;justify-content:space-between}
`;

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [namaBisnis, setNamaBisnis] = useState("");
  const [password, setPassword] = useState("");
  const [konfirmasi, setKonfirmasi] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password minimal 8 karakter");
      return;
    }
    if (password !== konfirmasi) {
      setError("Konfirmasi password tidak cocok");
      return;
    }
    setLoading(true);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, namaBisnis }),
    });
    setLoading(false);
    if (res.ok) {
      router.push("/pilih-paket");
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Gagal mendaftar");
    }
  }

  return (
    <div className="kp-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <header className="kp-head">
        <nav className="kp-nav">
          <Link href="/" className="kp-logo">
            <span className="mk">KP</span>
            <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
              <span style={{ fontWeight: 800, fontSize: 17 }}>KontenPilot</span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,.5)", letterSpacing: ".08em" }}>by Agustap Studio</span>
            </span>
          </Link>
          <div style={{ fontSize: 14, color: "rgba(255,255,255,.6)" }}>
            Sudah punya akun?{" "}
            <Link href="/login" style={{ fontWeight: 700 }}>Masuk</Link>
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
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "rgba(255,255,255,.85)" }}>
              “Sangat membantu sekali, apalagi semua serba otomatis — dan terbukti mendatangkan konsumen.”
            </p>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,.55)" }}>
              <strong style={{ color: "#fff" }}>Pelangi Homestay</strong> · Homestay, Bedugul
            </div>
          </div>
        </section>

        <section className="kp-card">
          <h2>Buat akun</h2>
          <form onSubmit={handleSubmit}>
            <label className="kp-field">Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required placeholder="nama@email.com" autoComplete="email" />
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
            {error && <p className="kp-err">{error}</p>}
            <button type="submit" className="kp-btn" disabled={loading}>
              {loading ? "Mendaftar…" : "Daftar →"}
            </button>
            <p style={{ marginTop: 14, fontSize: 12, lineHeight: 1.55, color: "rgba(255,255,255,.55)", textAlign: "center" }}>
              Lanjut berarti setuju Syarat &amp; Ketentuan dan Kebijakan Privasi.
            </p>
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
