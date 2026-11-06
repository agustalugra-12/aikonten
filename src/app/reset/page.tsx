"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Reset password - LANGKAH 2 (2026-11-06, P1.6). Token dari query ?token= (dibaca di client,
// hindari useSearchParams+Suspense). POST /api/auth/reset { token, password }.
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

export default function ResetPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [konfirmasi, setKonfirmasi] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try { setToken(new URLSearchParams(window.location.search).get("token") || ""); } catch {}
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError("Password minimal 8 karakter."); return; }
    if (password !== konfirmasi) { setError("Konfirmasi password tidak cocok."); return; }
    setLoading(true);
    const res = await fetch("/api/auth/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) { setError(data.error || "Gagal mengatur ulang password."); return; }
    setDone(true);
    setTimeout(() => { router.push("/login"); }, 1800);
  }

  return (
    <div className="kp-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="kp-card">
        <h1>Atur ulang password</h1>
        {done ? (
          <p className="kp-ok">Password berhasil diubah. Mengarahkan ke halaman masuk…</p>
        ) : !token ? (
          <p className="kp-err">Tautan tidak lengkap. Minta ulang dari halaman <Link href="/forgot">Lupa password</Link>.</p>
        ) : (
          <>
            <p className="sub">Masukkan password baru untuk akunmu.</p>
            <form onSubmit={submit}>
              <label className="kp-field">Password baru
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required minLength={8} autoComplete="new-password" />
              </label>
              <label className="kp-field">Ulangi password
                <input type="password" value={konfirmasi} onChange={(e) => setKonfirmasi(e.target.value)} required minLength={8} autoComplete="new-password" />
              </label>
              {error && <p className="kp-err">{error}</p>}
              <button type="submit" className="kp-btn" disabled={loading}>{loading ? "Menyimpan…" : "Simpan password baru"}</button>
            </form>
          </>
        )}
        <p className="kp-alt"><Link href="/login">Kembali ke masuk</Link></p>
      </div>
    </div>
  );
}
