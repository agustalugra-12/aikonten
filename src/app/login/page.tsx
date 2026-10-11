"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Halaman login (restyle 2026-10-11 ke desain KontenPilot gelap). LOGIKA & KONTRAK TETAP:
// POST /api/auth/login { email, password }; sukses -> cek /api/master/me -> admin ke
// /master, pelanggan ke /. Hanya tampilan yang diganti.
const CSS = `
.kp-wrap{--bg:#070710;--bg2:#0b0b16;--fg:#fff;--ink:255,255,255;--acc:#a5b4fc;--acc2:#818cf8;--err:#fca5a5;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--fg);font-family:var(--font-heading),'Plus Jakarta Sans',system-ui,sans-serif;background-image:radial-gradient(900px 600px at 85% -10%, rgba(99,102,241,.14), transparent 60%);-webkit-font-smoothing:antialiased;padding:24px}
.kp-wrap *{box-sizing:border-box}
.kp-wrap a{color:var(--acc);text-decoration:none}.kp-wrap a:hover{color:var(--fg)}
.kp-card{width:100%;max-width:400px;border:1px solid rgba(var(--ink),.1);background:rgba(var(--ink),.03);border-radius:24px;padding:clamp(24px,4vw,34px)}
.kp-logo{display:flex;align-items:center;gap:10px;margin-bottom:22px}
.kp-logo .mk{width:34px;height:34px;border-radius:9px;background:#6366f1;display:grid;place-items:center;font-weight:800;font-size:16px}
.kp-card h1{margin:0;font-size:22px;font-weight:800}
.kp-card .sub{margin:6px 0 0;font-size:14px;color:rgba(var(--ink),.6)}
.kp-field{display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:600;color:rgba(var(--ink),.78);margin-top:16px}
.kp-field input{background:var(--bg2);border:1px solid rgba(var(--ink),.14);border-radius:12px;padding:14px;color:var(--fg);font-size:16px;font-family:inherit;outline:none}
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      setLoading(false);
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Gagal login");
      return;
    }
    const me = await fetch("/api/master/me").then((r) => r.json()).catch(() => ({ isAdmin: false }));
    router.push(me.isAdmin ? "/master" : "/");
    router.refresh();
  }

  return (
    <div className="kp-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="kp-card">
        <Link href="/" className="kp-logo" style={{ color: "#fff" }}>
          <span className="mk">KP</span>
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
            <span style={{ fontWeight: 800, fontSize: 17 }}>KontenPilot</span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,.5)", letterSpacing: ".08em" }}>by Agustap Studio</span>
          </span>
        </Link>
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
        <p className="kp-alt">Belum punya akun? <Link href="/signup" style={{ fontWeight: 700 }}>Daftar di sini</Link></p>
      </div>
    </div>
  );
}
