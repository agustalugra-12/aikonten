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
    ...(isAgustap ? [{ key: "inspirasi", label: "Inspirasi & Benchmark", icon: "lightbulb" }] : []),
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
        {tab === "inspirasi" && isAgustap && <AgustapIntelligence brandId={brandId} />}
      </div>
    </div>
  );
}
