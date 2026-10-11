"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

// Onboarding pasca-bayar (restyle + theme-aware 2026-10-11, ikut OS). LOGIKA & KONTRAK TETAP:
// GET /api/account/credits (butuh plan) + /api/brands; belum bayar->/pilih-paket, sudah ada
// brand->/. Step1: POST /api/brands { name }. Step2 (plan.izinAutoPosting): tuntun Buffer.
type Plan = { nama: string; izinAutoPosting: boolean } | null;

const CSS = `
.kp-wrap{--bg:#f6f6f3;--bg2:#ffffff;--fg:#0b0b16;--ink:11,11,22;--acc:#4f46e5;--acc2:#6366f1;--acc-soft:#4338ca}
@media (prefers-color-scheme:dark){.kp-wrap{--bg:#070710;--bg2:#0b0b16;--fg:#fff;--ink:255,255,255;--acc:#a5b4fc;--acc2:#818cf8;--acc-soft:#c7d2fe}}
.kp-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--fg);font-family:var(--font-heading),'Plus Jakarta Sans',system-ui,sans-serif;background-image:radial-gradient(900px 600px at 85% -10%, rgba(99,102,241,.14), transparent 60%);-webkit-font-smoothing:antialiased;padding:24px}
.kp-wrap *{box-sizing:border-box}
.kp-card{width:100%;max-width:440px;border:1px solid rgba(var(--ink),.1);background:var(--bg2);border-radius:24px;padding:clamp(24px,4vw,34px);box-shadow:0 20px 50px rgba(0,0,0,.06)}
.kp-step{font-size:12px;font-weight:800;letter-spacing:.14em;color:var(--acc-soft);text-transform:uppercase}
.kp-card h1{margin:8px 0 0;font-size:22px;font-weight:800}
.kp-card p{font-size:14px;line-height:1.6;color:rgba(var(--ink),.68);margin:14px 0 0}
.kp-card p b{color:var(--fg)}
.kp-field{display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:600;color:rgba(var(--ink),.78);margin-top:16px}
.kp-field input{background:var(--bg);border:1px solid rgba(var(--ink),.14);border-radius:12px;padding:14px;color:var(--fg);font-size:16px;font-family:inherit;outline:none}
.kp-field input:focus{border-color:var(--acc2)}
.kp-btn{width:100%;margin-top:20px;border:0;cursor:pointer;background:#6366f1;color:#fff;border-radius:999px;padding:15px;font-size:16px;font-weight:800;font-family:inherit}
.kp-btn:disabled{opacity:.6;cursor:default}
.kp-ghost{width:100%;margin-top:10px;border:0;background:transparent;color:rgba(var(--ink),.6);cursor:pointer;font-family:inherit;font-size:14px;padding:8px}
.kp-muted{min-height:100vh;display:grid;place-items:center;background:var(--bg);color:rgba(var(--ink),.6);font-family:var(--font-heading),system-ui}
`;

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<Plan>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [nama, setNama] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [acc, brands] = await Promise.all([
          fetch("/api/account/credits").then((r) => r.json()),
          fetch("/api/brands").then((r) => r.json()),
        ]);
        if (!acc?.plan) { router.replace("/pilih-paket"); return; }
        if (Array.isArray(brands) && brands.length > 0) { router.replace("/"); return; }
        setPlan(acc.plan);
      } catch {
        toast.error("Gagal memuat data akun");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function buatBrand(e: React.FormEvent) {
    e.preventDefault();
    if (!nama.trim()) return;
    setBusy(true);
    const res = await fetch("/api/brands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nama.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error || "Gagal membuat brand");
      return;
    }
    toast.success("Brand pertama kamu dibuat!");
    if (plan?.izinAutoPosting) setStep(2);
    else { router.push("/"); router.refresh(); }
  }

  if (loading) {
    return (<><style dangerouslySetInnerHTML={{ __html: CSS }} /><div className="kp-muted">Menyiapkan akun kamu…</div></>);
  }

  return (
    <div className="kp-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="kp-card">
        <div className="kp-step">Langkah {step} dari {plan?.izinAutoPosting ? 2 : 1}</div>
        <h1>{step === 1 ? "Buat brand pertama kamu" : "Sambungkan akun sosial media"}</h1>
        {step === 1 ? (
          <form onSubmit={buatBrand}>
            <p>Brand = bisnis/akun yang kontennya akan kamu buat. Bisa tambah brand lain nanti sesuai paket.</p>
            <label className="kp-field">Nama brand
              <input value={nama} onChange={(e) => setNama(e.target.value)} autoFocus required placeholder="mis. Kopi Senja" />
            </label>
            <button type="submit" className="kp-btn" disabled={busy}>{busy ? "Membuat…" : "Buat brand & lanjut →"}</button>
          </form>
        ) : (
          <div>
            <p>Paket <b style={{ textTransform: "capitalize" }}>{plan?.nama}</b> kamu bisa <b>auto-posting</b> ke sosial media. Daftar akun <b>Buffer</b> (gratis) lalu sambungkan kanal (Instagram/TikTok/dll) di menu <b>Kanal</b> di dashboard.</p>
            <p style={{ fontSize: 13, color: "rgba(var(--ink),.5)" }}>Kalau mau nanti saja, kamu tetap bisa membuat &amp; mengunduh konten dulu; auto-posting aktif setelah Buffer tersambung.</p>
            <button className="kp-btn" onClick={() => { router.push("/"); router.refresh(); }}>Ke dashboard (sambungkan Buffer)</button>
            <button className="kp-ghost" onClick={() => { router.push("/"); router.refresh(); }}>Nanti saja</button>
          </div>
        )}
      </div>
    </div>
  );
}
