"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Halaman login (restyle + theme-aware 2026-10-11, ikut OS). LOGIKA & KONTRAK TETAP:
// POST /api/auth/login { email, password }; sukses -> /api/master/me -> admin ke /master,
// pelanggan ke /. Logo asli, header -> situs utama.
const SITE = "https://agustapstudio.com";
const LOGO = "https://agustapstudio.com/assets/export/logo-agustap.png";
const CSS = `
.kp-wrap{--bg:#f6f6f3;--bg2:#ffffff;--fg:#0b0b16;--ink:11,11,22;--acc:#4f46e5;--acc2:#6366f1;--err:#b91c1c}
@media (prefers-color-scheme:dark){.kp-wrap{--bg:#070710;--bg2:#0b0b16;--fg:#fff;--ink:255,255,255;--acc:#a5b4fc;--acc2:#818cf8;--err:#fca5a5}}
.kp-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--fg);font-family:var(--font-heading),'Plus Jakarta Sans',system-ui,sans-serif;background-image:radial-gradient(900px 600px at 85% -10%, rgba(99,102,241,.14), transparent 60%);-webkit-font-smoothing:antialiased;padding:24px}
.kp-wrap *{box-sizing:border-box}
.kp-wrap a{color:var(--acc);text-decoration:none}.kp-wrap a:hover{color:var(--fg)}
.kp-card{width:100%;max-width:400px;border:1px solid rgba(var(--ink),.1);background:var(--bg2);border-radius:24px;padding:clamp(24px,4vw,34px);box-shadow:0 20px 50px rgba(0,0,0,.06)}
.kp-logo{display:flex;align-items:center;gap:10px;margin-bottom:22px;color:var(--fg)}
.kp-logo img{width:34px;height:34px;border-radius:9px;object-fit:cover}
.kp-logo .wm{display:flex;flex-direction:column;line-height:1.1}
.kp-logo .wm b{font-weight:800;font-size:16px}
.kp-logo .wm s{text-decoration:none;font-size:11px;color:rgba(var(--ink),.5);letter-spacing:.08em}
.kp-card h1{margin:0;font-size:22px;font-weight:800}
.kp-card .sub{margin:6px 0 0;font-size:14px;color:rgba(var(--ink),.6)}
.kp-field{display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:600;color:rgba(var(--ink),.78);margin-top:16px}
.kp-field input{background:var(--bg);border:1px solid rgba(var(--ink),.14);border-radius:12px;padding:14px;color:var(--fg);font-size:16px;font-family:inherit;outline:none}
.kp-field input:focus{border-color:var(--acc2)}
.kp-btn{width:100%;margin-top:22px;border:0;cursor:pointer;background:#6366f1;color:#fff;border-radius:999px;padding:15px;font-size:16px;font-weight:800;font-family:inherit;box-shadow:0 12px 32px rgba(99,102,241,.35)}
.kp-btn:disabled{opacity:.6;cursor:default}
.kp-err{margin-top:14px;font-size:14px;color:var(--err)}
.kp-alt{margin-top:18px;font-size:14px;color:rgba(var(--ink),.6);text-align:center}
`;

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [need2fa, setNeed2fa] = useState(false);
  const [code, setCode] = useState("");

  async function lanjutMasuk() {
    const me = await fetch("/api/master/me").then((r) => r.json()).catch(() => ({ isAdmin: false }));
    router.push(me.isAdmin ? "/master" : "/");
    router.refresh();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setLoading(false); setError(data.error || "Gagal login"); return; }
    if (data.need2fa) { setLoading(false); setNeed2fa(true); return; }
    await lanjutMasuk();
  }

  async function submit2fa(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await fetch("/api/auth/2fa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setLoading(false); setError(data.error || "Kode salah"); return; }
    await lanjutMasuk();
  }

  return (
    <div className="kp-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="kp-card">
        <a href={SITE} className="kp-logo">
          <img src={LOGO} alt="KontenPilot" />
          <span className="wm"><b>KontenPilot</b><s>by Agustap Studio</s></span>
        </a>
        {!need2fa ? (
        <>
        <h1>Masuk</h1>
        <p className="sub">Masuk ke dashboard KontenPilot kamu.</p>
        <form onSubmit={handleSubmit}>
          <label className="kp-field">Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required placeholder="nama@email.com" autoComplete="email" />
          </label>
          <label className="kp-field">Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </label>
          {error && <p className="kp-err">{error}</p>}
          <button type="submit" className="kp-btn" disabled={loading}>{loading ? "Masuk…" : "Masuk"}</button>
        </form>
        </>
        ) : (
        <>
        <h1>Verifikasi 2FA</h1>
        <p className="sub">Masukkan 6 digit kode dari aplikasi authenticator kamu.</p>
        <form onSubmit={submit2fa}>
          <label className="kp-field">Kode 2FA
            <input inputMode="numeric" pattern="[0-9]*" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus required placeholder="123456" style={{ letterSpacing: ".3em", textAlign: "center", fontSize: 22 }} />
          </label>
          {error && <p className="kp-err">{error}</p>}
          <button type="submit" className="kp-btn" disabled={loading || code.length !== 6}>{loading ? "Memeriksa…" : "Verifikasi"}</button>
        </form>
        </>
        )}
        <p className="kp-alt">Belum punya akun? <Link href="/signup" style={{ fontWeight: 700 }}>Daftar di sini</Link></p>
      </div>
    </div>
  );
}
