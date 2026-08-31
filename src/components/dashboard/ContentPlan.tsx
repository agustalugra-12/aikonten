"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useFetchedData } from "@/lib/useFetchedData";

type PlanRow = {
  id: string;
  kind: "idea" | "project";
  date: string;
  contentType: string | null;
  pillar: string | null;
  topicOrHook: string;
  structure: string | null;
  status: string;
  experimentTier: "proven" | "variation" | "experiment" | null;
  platformFitScores: Record<string, number>;
};

// Experiment Engine (2026-08-25, PRD §24) - label observational, lihat catatan lengkap
// di contentVariety.ts's classifyIdeaExperimentTier.
const TIER_LABEL: Record<string, string> = {
  proven: "Proven",
  variation: "Variasi",
  experiment: "Eksperimen",
};

const WINDOW_OPTIONS = [
  { days: 7, label: "7 hari" },
  { days: 14, label: "14 hari" },
  { days: 30, label: "30 hari" },
];

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  published: "default",
  "Sudah dipakai": "secondary",
  "Belum dipakai": "outline",
  failed: "destructive",
  partial: "outline",
  // Manual Per-Post Scheduling (2026-08-25, PRD §26)
  scheduled: "secondary",
};

type Suggestion = {
  pillar: string; topic: string; hookType: string; reasoning: string;
  whyNow: string; whyAudience: string; whyBrand: string; risk: string;
};

// Content Planning Engine (2026-08-19, PRD §22-23) - tabel kronologis gabungan ide
// (belum diproduksi) + konten (sudah/sedang diproduksi). Sejak SWOT/Competitor
// unblocked (e4264c2), tab ini juga punya panel "AI Sarankan Rencana" (versi PENUH) -
// AI gabungkan SWOT+Competitor+Historical Performance+Content Diversity jadi draf
// saran, non-binding (staf klik Terima per saran, pola sama SELURUH AI call lain di
// app ini - lihat lib/ai/contentPlanSuggestions.ts).
export function ContentPlan({ brandId }: { brandId: string }) {
  const [days, setDays] = useState(14);
  const { data: rows, loading } = useFetchedData<PlanRow[]>(
    () => fetch(`/api/brands/${brandId}/content-plan?days=${days}`).then((res) => res.json()).then((data) => data.rows),
    [brandId, days]
  );
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [acceptingIdx, setAcceptingIdx] = useState<number | null>(null);
  const [acceptedIdx, setAcceptedIdx] = useState<Set<number>>(new Set());

  const handleSuggest = () => {
    setSuggestLoading(true);
    setAcceptedIdx(new Set());
    fetch(`/api/brands/${brandId}/content-plan/suggest`, { method: "POST" })
      .then((res) => res.json())
      .then((data) => setSuggestions(data.suggestions || []))
      .finally(() => setSuggestLoading(false));
  };

  const handleAccept = (idx: number, s: Suggestion) => {
    setAcceptingIdx(idx);
    const idea = `[${s.pillar}] ${s.topic} (hook: ${s.hookType})`;
    fetch(`/api/brands/${brandId}/manual-ideas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) setAcceptedIdx((prev) => new Set(prev).add(idx));
      })
      .finally(() => setAcceptingIdx(null));
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle>AI Sarankan Rencana</CardTitle>
          <Button size="sm" onClick={handleSuggest} disabled={suggestLoading}>
            {suggestLoading ? "Menyusun saran..." : "AI Sarankan Rencana"}
          </Button>
        </CardHeader>
        {suggestions !== null && (
          <CardContent>
            {suggestions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Tidak ada saran - coba isi catatan kompetitor dulu di tab Kompetitor supaya AI punya lebih banyak sinyal.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {suggestions.map((s, idx) => (
                  <div key={idx} className="flex items-start justify-between gap-3 rounded-md border p-3">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{s.pillar}</Badge>
                        <Badge variant="secondary">{s.hookType}</Badge>
                      </div>
                      <p className="text-sm font-medium">{s.topic}</p>
                      <p className="text-xs text-muted-foreground">{s.reasoning}</p>
                      {/* Content Strategist explanation (2026-08-26, PRD §11, Task Plan 6) */}
                      <div className="text-xs text-muted-foreground space-y-0.5 mt-1">
                        {s.whyNow && <p><span className="font-medium text-foreground">Kenapa sekarang:</span> {s.whyNow}</p>}
                        {s.whyAudience && <p><span className="font-medium text-foreground">Audiens:</span> {s.whyAudience}</p>}
                        {s.whyBrand && <p><span className="font-medium text-foreground">Kecocokan brand:</span> {s.whyBrand}</p>}
                        {s.risk && <p><span className="font-medium text-foreground">Resiko:</span> {s.risk}</p>}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={acceptedIdx.has(idx) ? "secondary" : "default"}
                      disabled={acceptingIdx === idx || acceptedIdx.has(idx)}
                      onClick={() => handleAccept(idx, s)}
                    >
                      {acceptedIdx.has(idx) ? "Diterima" : acceptingIdx === idx ? "Menyimpan..." : "Terima"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>
      <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
        <CardTitle>Rencana &amp; Riwayat Konten</CardTitle>
        <div className="flex items-center gap-2">
          {WINDOW_OPTIONS.map((opt) => (
            <Button
              key={opt.days}
              variant={days === opt.days ? "default" : "outline"}
              size="sm"
              onClick={() => setDays(opt.days)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {loading || rows === null ? (
          <p className="text-sm text-muted-foreground">Memuat...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada ide atau konten di jendela waktu ini.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Tanggal</th>
                  <th className="py-2 pr-3 font-medium">Jenis</th>
                  <th className="py-2 pr-3 font-medium">Tipe Konten</th>
                  <th className="py-2 pr-3 font-medium">Pilar</th>
                  <th className="py-2 pr-3 font-medium">Topik / Hook</th>
                  <th className="py-2 pr-3 font-medium">Struktur</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.kind}-${r.id}`} className="border-b last:border-0">
                    <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{r.date}</td>
                    <td className="py-2 pr-3">
                      <Badge variant="outline">{r.kind === "idea" ? "Ide" : "Konten"}</Badge>
                    </td>
                    <td className="py-2 pr-3">
                      {r.contentType || "-"}
                      {r.experimentTier && (
                        <Badge variant="outline" className="ml-1 text-xs">{TIER_LABEL[r.experimentTier]}</Badge>
                      )}
                    </td>
                    <td className="py-2 pr-3">{r.pillar || "-"}</td>
                    <td className="py-2 pr-3 max-w-xs">
                      <div className="truncate" title={r.topicOrHook}>{r.topicOrHook || "-"}</div>
                      {Object.keys(r.platformFitScores).length > 0 && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {Object.entries(r.platformFitScores)
                            .sort((a, b) => b[1] - a[1])
                            .map(([platform, score]) => `${platform} ${score}`)
                            .join(" · ")}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3">{r.structure || "-"}</td>
                    <td className="py-2">
                      <Badge variant={STATUS_VARIANT[r.status] || "secondary"}>{r.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      </Card>
    </div>
  );
}
