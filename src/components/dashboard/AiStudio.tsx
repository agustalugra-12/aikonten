"use client";

import { useState } from "react";
import { FatigueSummary } from "@/components/dashboard/FatigueSummary";
import { CompetitorIntelligence } from "@/components/dashboard/CompetitorIntelligence";
import { AgustapIntelligence } from "@/components/dashboard/AgustapIntelligence";
import type { Brand } from "@/types";

// AI Studio & R&D - port Stitch (2026-09-12, PRD). Menyatukan modul AI Intelligence
// existing jadi satu halaman bertab: Content Fatigue + Kompetitor (+ Inspirasi/Benchmark
// khusus Agustap). REUSE komponen existing apa adanya (FatigueSummary/CompetitorIntelligence/
// AgustapIntelligence) - UI berubah (shell tab bergaya Stitch), engine tetap.

const AGUSTAP_KNOWLEDGE_SITE = "agustap_studio";

export function AiStudio({ brandId, brand }: { brandId: string; brand: Brand | null }) {
  const isAgustap = brand?.knowledgeSite === AGUSTAP_KNOWLEDGE_SITE;
  const tabs = [
    { key: "fatigue", label: "Content Fatigue", icon: "hourglass_bottom" },
    { key: "kompetitor", label: "Kompetitor", icon: "radar" },
    { key: "benchmark", label: "Creator Benchmark", icon: "military_tech" },
    ...(isAgustap ? [{ key: "inspirasi", label: "Inspirasi", icon: "lightbulb" }] : []),
  ] as const;
  const [tab, setTab] = useState<string>("fatigue");

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[#555f6d]">
          <span>Workspace Intelligence</span>
          <span className="text-[#c6c6cd]">•</span>
          <span className="text-[#151c27] font-semibold">AI Studio &amp; R&amp;D</span>
        </div>
        <h1 className="font-heading text-2xl font-bold tracking-tight text-[#151c27] mt-1">AI Studio &amp; R&amp;D</h1>
        <p className="text-[13px] text-[#555f6d] mt-0.5">Riset kejenuhan topik, pantauan kompetitor, &amp; inspirasi konten.</p>
      </div>

      <div className="flex items-center gap-1 p-1 rounded-lg bg-[#f0f3ff] w-fit overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={"px-3 py-1.5 rounded-md text-[12px] font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors " + (tab === t.key ? "bg-black text-white shadow-sm" : "text-[#555f6d] hover:text-[#151c27]")}
          >
            <span className="material-symbols-outlined text-[16px]">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <div>
        {tab === "fatigue" && <FatigueSummary brandId={brandId} />}
        {tab === "kompetitor" && <CompetitorIntelligence brandId={brandId} />}
        {tab === "benchmark" && <CreatorBenchmarkPanel brandId={brandId} />}
        {tab === "inspirasi" && isAgustap && <AgustapIntelligence brandId={brandId} />}
      </div>
    </div>
  );
}

type BenchmarkProfile = {
  hookPattern: string;
  storytellingPattern: string;
  contentAngle: string;
  pacing: string;
  ctaPattern: string;
  visualPattern: string;
  audiencePattern: string;
};
type BenchmarkResult =
  | { ok: true; profile: BenchmarkProfile; analyzedContentCount: number }
  | { ok: false; error: string; detail: string };

// Creator Benchmark umum (2026-09-12) - analisis kreator dari URL konten (engine
// analyzeInspiration existing lewat endpoint creator-benchmark). Ephemeral: tampil
// hasilnya, belum dipersistensikan. Berlaku semua brand (bukan agustap-only).
function CreatorBenchmarkPanel({ brandId }: { brandId: string }) {
  const [creatorName, setCreatorName] = useState("");
  const [accountUrl, setAccountUrl] = useState("");
  const [urls, setUrls] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BenchmarkResult | null>(null);

  async function run() {
    if (!creatorName.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const contentUrls = urls.split(/[\n,]+/).map((u) => u.trim()).filter(Boolean);
      const res = await fetch(`/api/brands/${brandId}/creator-benchmark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creatorName: creatorName.trim(), accountUrl: accountUrl.trim(), contentUrls }),
      });
      setResult(await res.json());
    } catch {
      setResult({ ok: false, error: "NET", detail: "Gagal memanggil analisis." });
    } finally {
      setLoading(false);
    }
  }

  const rows: [string, keyof BenchmarkProfile][] = [
    ["Pola Hook", "hookPattern"],
    ["Storytelling", "storytellingPattern"],
    ["Content Angle", "contentAngle"],
    ["Pacing", "pacing"],
    ["Pola CTA", "ctaPattern"],
    ["Visual", "visualPattern"],
    ["Audiens", "audiencePattern"],
  ];

  return (
    <div className="rounded-xl bg-white ring-1 ring-[#e7eefe] shadow-sm p-4 space-y-3">
      <div>
        <p className="font-heading text-sm font-semibold text-[#151c27]">Analisis Creator Benchmark</p>
        <p className="text-[11px] text-[#555f6d] mt-0.5">Tempel nama + beberapa URL konten kreator panutan; AI ekstrak pola hook/storytelling/CTA-nya (dari konten nyata, bukan tebakan).</p>
      </div>
      <input value={creatorName} onChange={(e) => setCreatorName(e.target.value)} placeholder="Nama kreator (mis. Felix Growth)" className="w-full h-9 px-3 rounded-lg bg-[#f0f3ff] text-[13px] focus:outline-none" />
      <input value={accountUrl} onChange={(e) => setAccountUrl(e.target.value)} placeholder="URL akun (opsional - sering gagal utk platform JS)" className="w-full h-9 px-3 rounded-lg bg-[#f0f3ff] text-[13px] focus:outline-none" />
      <textarea value={urls} onChange={(e) => setUrls(e.target.value)} rows={3} placeholder="URL konten (1 per baris) - lebih andal daripada URL akun" className="w-full px-3 py-2 rounded-lg bg-[#f0f3ff] text-[13px] focus:outline-none resize-none" />
      <button onClick={run} disabled={loading || !creatorName.trim()} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-black text-white text-[13px] font-medium disabled:opacity-60">
        <span className={"material-symbols-outlined text-[16px] " + (loading ? "animate-spin" : "")}>{loading ? "progress_activity" : "insights"}</span>
        {loading ? "Menganalisis…" : "Analisis Benchmark"}
      </button>

      {result && result.ok && (
        <div className="pt-2 space-y-2">
          <p className="text-[11px] text-[#555f6d]">{result.analyzedContentCount} konten dianalisis</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {rows.map(([label, key]) => (
              <div key={key} className="rounded-lg bg-[#f0f3ff] p-2.5">
                <p className="text-[10px] uppercase tracking-wider text-[#555f6d] font-semibold">{label}</p>
                <p className="text-[12px] text-[#151c27] mt-0.5">{result.profile[key]}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {result && !result.ok && <p className="text-[12px] text-[#93000a] bg-[#ffdad6] rounded-lg p-2.5">{result.detail}</p>}
    </div>
  );
}
