"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Trash2, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useFetchedData } from "@/lib/useFetchedData";

// Agustap Studio Content Intelligence - UI Phase 2 (PRD §2.18-2.19, 2026-09-02).
// Component ini HANYA dirender kalau brand.knowledgeSite === "agustap_studio"
// (gate di src/app/page.tsx & Sidebar.tsx, BUKAN di sini) - §2.21 Isolation:
// "Jangan masuk Global ContentPilot Knowledge, brand lain tidak boleh
// mendapatkan benchmark Agustap." REUSE endpoint /api/brands/[id]/competitors
// (extended) & /api/brands/[id]/content-inspiration (baru) - tidak ada
// dashboard/editor terpisah (§31, §33), cuma tab tambahan di dashboard existing.

type CreatorBenchmark = {
  id: string;
  name: string;
  role: string | null;
  notes: string | null;
  benchmarkProfile: string | null;
  benchmarkActive: boolean;
  analyzedContentCount: number | null;
};

type SavedInspiration = {
  id: string;
  idea: string;
  sourceUrl: string | null;
  creatorName: string | null;
  used: boolean;
};

export function AgustapIntelligence({ brandId }: { brandId: string }) {
  const { data: benchmarksRaw, loading: loadingBenchmarks, refetch: loadBenchmarks } = useFetchedData<CreatorBenchmark[]>(
    async () => {
      const res = await fetch(`/api/brands/${brandId}/competitors`);
      const data = await res.json();
      return data.competitors || [];
    },
    [brandId]
  );
  const benchmarks = benchmarksRaw ?? [];

  const { data: inspirationsRaw, loading: loadingInspirations, refetch: loadInspirations } = useFetchedData<SavedInspiration[]>(
    async () => {
      const res = await fetch(`/api/brands/${brandId}/content-inspiration`);
      const data = await res.json();
      return data.inspirations || [];
    },
    [brandId]
  );
  const inspirations = inspirationsRaw ?? [];

  // --- Creator Benchmark form state ---
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("");
  const [newContentUrls, setNewContentUrls] = useState("");
  const [savingBenchmark, setSavingBenchmark] = useState(false);

  const addBenchmark = async () => {
    if (!newName.trim()) return;
    setSavingBenchmark(true);
    try {
      const contentUrls = newContentUrls
        .split("\n")
        .map((u) => u.trim())
        .filter((u) => u.length > 0);
      const res = await fetch(`/api/brands/${brandId}/competitors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, role: newRole || undefined, contentUrls: contentUrls.length > 0 ? contentUrls : undefined }),
      });
      const data = await res.json();
      if (contentUrls.length > 0 && !data.competitor?.benchmarkProfile) {
        toast.error("Analisis gagal - cek catatan di daftar creator utk detail (kemungkinan link tidak bisa diakses).");
      } else if (contentUrls.length > 0) {
        toast.success(`Benchmark profile berhasil dibuat dari ${contentUrls.length} link.`);
      } else {
        toast.success("Creator ditambahkan - belum ada profile (isi Content URL utk dianalisis).");
      }
      setNewName("");
      setNewRole("");
      setNewContentUrls("");
      loadBenchmarks();
    } catch {
      toast.error("Gagal menambah creator benchmark");
    } finally {
      setSavingBenchmark(false);
    }
  };

  const toggleActive = async (id: string, active: boolean) => {
    await fetch(`/api/brands/${brandId}/competitors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    loadBenchmarks();
  };

  const deleteBenchmark = async (id: string) => {
    await fetch(`/api/brands/${brandId}/competitors/${id}`, { method: "DELETE" });
    loadBenchmarks();
  };

  // --- Content Inspiration form state ---
  const [newUrl, setNewUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);

  const analyzeContent = async () => {
    if (!newUrl.trim()) return;
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/brands/${brandId}/content-inspiration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referenceUrl: newUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.detail || "Konten tidak bisa dianalisis (SOURCE_UNAVAILABLE).");
      } else {
        toast.success("Inspirasi tersimpan.");
        setNewUrl("");
        loadInspirations();
      }
    } catch {
      toast.error("Gagal menganalisis konten");
    } finally {
      setAnalyzing(false);
    }
  };

  const deleteInspiration = async (id: string) => {
    await fetch(`/api/brands/${brandId}/content-inspiration/${id}`, { method: "DELETE" });
    loadInspirations();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Creator Benchmark</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Background intelligence yang dipakai OTOMATIS tiap generate konten (§2.4) - tidak
            perlu dipilih manual tiap kali. AI belajar POLA (hook/storytelling/angle/pacing/CTA),
            bukan menyalin konten asli. Isi Content URL (1 link per baris, beberapa konten
            sekaligus) untuk dianalisis jadi profile, atau kosongkan dulu & isi belakangan.
          </p>
          <div className="space-y-2 rounded-lg border p-3">
            <Input placeholder="Nama creator" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <Input placeholder="Role/strength (opsional, mis. hook / attention)" value={newRole} onChange={(e) => setNewRole(e.target.value)} />
            <textarea
              placeholder="Content URL (1 per baris, opsional - kosongkan kalau belum ada)"
              value={newContentUrls}
              onChange={(e) => setNewContentUrls(e.target.value)}
              rows={3}
              className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <Button size="sm" onClick={addBenchmark} disabled={savingBenchmark || !newName.trim()}>
              {savingBenchmark ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Tambah Creator
            </Button>
          </div>

          {loadingBenchmarks ? (
            <p className="text-sm text-muted-foreground">Memuat...</p>
          ) : benchmarks.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada creator benchmark.</p>
          ) : (
            <div className="space-y-2">
              {benchmarks.map((b) => (
                <div key={b.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium">{b.name}</p>
                      {b.benchmarkActive ? (
                        <Badge>Active</Badge>
                      ) : (
                        <Badge variant="outline">Inactive</Badge>
                      )}
                      {b.benchmarkProfile ? (
                        <Badge variant="secondary">Profile ready{b.analyzedContentCount ? ` (${b.analyzedContentCount} konten)` : ""}</Badge>
                      ) : (
                        <Badge variant="outline">Belum dianalisis</Badge>
                      )}
                    </div>
                    {b.role && <p className="text-xs text-muted-foreground mt-1">{b.role}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant={b.benchmarkActive ? "outline" : "default"} onClick={() => toggleActive(b.id, !b.benchmarkActive)} disabled={!b.benchmarkProfile}>
                      {b.benchmarkActive ? "Nonaktifkan" : "Aktifkan"}
                    </Button>
                    <button onClick={() => deleteBenchmark(b.id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Content Inspiration</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Analisis SATU konten spesifik jadi insight yang bisa dipilih optional saat generate
            (§2.1.B) - beda dari Creator Benchmark yang otomatis. Kalau tidak dipilih, benchmark
            tetap dipakai seperti biasa.
          </p>
          <div className="flex gap-2">
            <Input placeholder="Paste content URL" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} />
            <Button onClick={analyzeContent} disabled={analyzing || !newUrl.trim()}>
              {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Analyze"}
            </Button>
          </div>

          {loadingInspirations ? (
            <p className="text-sm text-muted-foreground">Memuat...</p>
          ) : inspirations.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada inspirasi tersimpan.</p>
          ) : (
            <div className="space-y-2">
              {inspirations.map((insp) => (
                <div key={insp.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                  <div className="min-w-0">
                    <p className="text-sm">{insp.idea}</p>
                    {insp.sourceUrl && <p className="text-xs text-muted-foreground mt-1 truncate">{insp.sourceUrl}</p>}
                  </div>
                  <button onClick={() => deleteInspiration(insp.id)} className="shrink-0 text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
