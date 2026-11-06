"use client";

import { useState } from "react";
import Link from "next/link";

// Lupa password - LANGKAH 1 (2026-11-06, P1.6). POST /api/auth/forgot { email }. Anti-enumerasi:
// server selalu balas sama; UI tampilkan pesan netral "jika terdaftar".
const CSS = `
.kp-wrap{--bg:#f6f6f3;--bg2:#ffffff;--fg:#0b0b16;--ink:11,11,22;--acc:#4f46e5;--acc2:#6366f1;--err:#b91c1c;--ok:#15803d}
@media (prefers-color-scheme:dark){.kp-wrap{--bg:#070710;--bg2:#0b0b16;--fg:#fff;--ink:255,255,255;--acc:#a5b4fc;--acc2:#818cf8;--err:#fca5a5;--ok:#86efac}}
.kp-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--fg);font-family:var(--font-heading),Plus Jakarta Sans,system-ui,sans-serif;background-image:radial-gradient(900px 600px at 85% -10%, rgba(99,102,241,.14), transparent 60%);-webkit-font-smoothing:antialiased;padding:24px}
.kp-wrap *{box-sizing:border-box}
.kp-wrap a{color:var(--acc);text-decoration:none}.kp-wrap a:hover{color:var(--fg)}
.kp-card{width:100%;max-width:400px;border:1px solid rgba(var(--ink),.1);background:var(--bg2);border-radius:24px;padding:clamp(24px,4vw,34px);box-shadow:0 20px 50px rgba(0,0,0,.06)}
.kp-card h1{margin:0;font-size:22px;font-weight:800}
.kp-card .sub{margin:8px 0 0;font-size:14px;color:rgba(var(--ink),.6)}
.kp-field{display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:600;color:rgba(var(--ink),.78);margin-top:16px}
.kp-field input{background:var(--bg);border:1px solid rgba(var(--ink),.14);border-radius:12px;padding:14px;color:var(--fg);font-size:16px;font-family:inherit;outline:none}
.kp-field input:focus{border-color:var(--acc2)}
.kp-btn{width:100%;margin-top:22px;border:0;cursor:pointer;background:#6366f1;color:#fff;border-radius:999px;padding:15px;font-size:16px;font-weight:800;font-family:inherit;box-shadow:0 12px 32px rgba(99,102,241,.35)}
.kp-btn:disabled{opacity:.6;cursor:default}
.kp-err{margin-top:14px;font-size:14px;color:var(--err)}
.kp-ok{margin-top:14px;font-size:14px;color:var(--ok)}
.kp-alt{margin-top:18px;font-size:14px;color:rgba(var(--ink),.6);text-align:center}
`;

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    const res = await fetch("/api/auth/forgot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) { setError(data.error || "Gagal mengirim. Coba lagi."); return; }
    setDone(true);
  }

  return (
    <div className="kp-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="kp-card">
        <h1>Lupa password</h1>
        {done ? (
          <p className="kp-ok">Jika email terdaftar, tautan reset sudah dikirim. Cek kotak masuk (dan folder spam) kamu.</p>
        ) : (
          <>
            <p className="sub">Masukkan email akunmu. Kami kirim tautan untuk mengatur ulang password.</p>
            <form onSubmit={submit}>
              <label className="kp-field">Email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required placeholder="nama@email.com" autoComplete="email" />
              </label>
              {error && <p className="kp-err">{error}</p>}
              <button type="submit" className="kp-btn" disabled={loading}>{loading ? "Mengirim…" : "Kirim tautan reset"}</button>
            </form>
          </>
        )}
        <p className="kp-alt"><Link href="/login">Kembali ke masuk</Link></p>
      </div>
    </div>
  );
}
