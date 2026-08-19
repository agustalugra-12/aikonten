"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Trash2, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Competitor = { id: string; name: string; notes: string | null; createdAt: string; updatedAt: string };
type AnalysisResult = {
  contentGap: { competitorDoing: string[]; competitorMissing: string[]; opportunities: string[] };
  swot: { strength: string[]; weakness: string[]; opportunity: string[]; threat: string[] };
};

const SWOT_META: { key: keyof AnalysisResult["swot"]; label: string; variant: "default" | "secondary" | "destructive" | "outline" }[] = [
  { key: "strength", label: "Strength", variant: "default" },
  { key: "weakness", label: "Weakness", variant: "secondary" },
  { key: "opportunity", label: "Opportunity", variant: "outline" },
  { key: "threat", label: "Threat", variant: "destructive" },
];

// Competitor Intelligence + SWOT (2026-08-19, PRD §5-8, scope: "tanpa API berbayar" -
// keputusan Agus). Data kompetitor MURNI catatan manual staf (nama + observasi bebas),
// TIDAK ADA integrasi/scraping otomatis apa pun. AI cuma menganalisis catatan itu +
// performa brand sendiri jadi Content Gap & SWOT - lihat lib/ai/competitorAnalysis.ts.
export function CompetitorIntelligence({ brandId }: { brandId: string }) {
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const load = () => {
    setLoading(true);
    fetch(`/api/brands/${brandId}/competitors`)
      .then((res) => res.json())
      .then((data) => setCompetitors(data.competitors || []))
      .finally(() => setLoading(false));
  };

  useEffect(load, [brandId]);

  const addCompetitor = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await fetch(`/api/brands/${brandId}/competitors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, notes: newNotes }),
      });
      setNewName("");
      setNewNotes("");
      load();
    } catch {
      toast.error("Gagal menyimpan kompetitor");
    } finally {
      setSaving(false);
    }
  };

  const deleteCompetitor = async (id: string) => {
    await fetch(`/api/brands/${brandId}/competitors/${id}`, { method: "DELETE" });
    load();
  };

  const runAnalysis = async () => {
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/brands/${brandId}/competitor-analysis`, { method: "POST" });
      const data = await res.json();
      setAnalysis(data);
      const hasAnything = Object.values(data.contentGap || {}).some((v) => Array.isArray(v) && v.length > 0);
      if (!hasAnything) {
        toast.error("Catatan kompetitor masih terlalu sedikit untuk dianalisis - tambah observasi yang lebih detail dulu.");
      }
    } catch {
      toast.error("Gagal menjalankan analisis");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Kompetitor</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Tulis observasi manual soal kompetitor (bukan angka pasti, cukup pengamatan: platform,
            kira-kira frekuensi posting, jenis konten yang sering/jarang dibuat, kekuatan/kelemahan
            yang kamu lihat). Tidak ada pengambilan data otomatis dari internet.
          </p>
          <div className="space-y-2 rounded-lg border p-3">
            <Input placeholder="Nama kompetitor" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <textarea
              placeholder="Catatan: platform, frekuensi posting, jenis konten, kekuatan/kelemahan..."
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              rows={3}
              className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <Button size="sm" onClick={addCompetitor} disabled={saving || !newName.trim()}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Tambah Kompetitor"}
            </Button>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">Memuat...</p>
          ) : competitors.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada kompetitor ditambahkan.</p>
          ) : (
            <div className="space-y-2">
              {competitors.map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{c.name}</p>
                    {c.notes && <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{c.notes}</p>}
                  </div>
                  <button onClick={() => deleteCompetitor(c.id)} className="shrink-0 text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <Button onClick={runAnalysis} disabled={analyzing || competitors.length === 0} className="gap-1.5">
            {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            Generate Analisis (Content Gap + SWOT)
          </Button>
        </CardContent>
      </Card>

      {analysis && (
        <>
          <Card>
            <CardHeader><CardTitle>Content Gap</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Kompetitor Sering Buat</p>
                {analysis.contentGap.competitorDoing.length === 0 ? <p className="text-xs text-muted-foreground">-</p> : (
                  <ul className="text-sm space-y-1 list-disc list-inside">{analysis.contentGap.competitorDoing.map((x, i) => <li key={i}>{x}</li>)}</ul>
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Kompetitor Jarang Buat</p>
                {analysis.contentGap.competitorMissing.length === 0 ? <p className="text-xs text-muted-foreground">-</p> : (
                  <ul className="text-sm space-y-1 list-disc list-inside">{analysis.contentGap.competitorMissing.map((x, i) => <li key={i}>{x}</li>)}</ul>
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Peluang Konten</p>
                {analysis.contentGap.opportunities.length === 0 ? <p className="text-xs text-muted-foreground">-</p> : (
                  <ul className="text-sm space-y-1 list-disc list-inside">{analysis.contentGap.opportunities.map((x, i) => <li key={i}>{x}</li>)}</ul>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>SWOT</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {SWOT_META.map(({ key, label, variant }) => (
                <div key={key}>
                  <Badge variant={variant} className="mb-2">{label}</Badge>
                  {analysis.swot[key].length === 0 ? (
                    <p className="text-xs text-muted-foreground">-</p>
                  ) : (
                    <ul className="text-sm space-y-1 list-disc list-inside">
                      {analysis.swot[key].map((x, i) => <li key={i}>{x}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
