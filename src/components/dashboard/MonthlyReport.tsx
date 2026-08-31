"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { useFetchedData } from "@/lib/useFetchedData";

type PerformanceBreakdown = { label: string; avgViews: number; count: number };
type StrategicRecommendation = {
  continue: string[];
  reduce: string[];
  stop: string[];
  increase: string[];
  test: string[];
};
type MonthlyReportData = {
  windowDays: number;
  totalContent: number;
  totalViews: number;
  avgEngagementRate: number | null;
  bestContent: { id: string; captionSnippet: string; views: number } | null;
  worstContent: { id: string; captionSnippet: string; views: number } | null;
  byContentType: PerformanceBreakdown[];
  byPillar: PerformanceBreakdown[];
  byHookType: PerformanceBreakdown[];
  byStructure: PerformanceBreakdown[];
  recommendation: StrategicRecommendation;
};

const RECO_META: { key: keyof StrategicRecommendation; label: string; variant: "default" | "secondary" | "destructive" | "outline" }[] = [
  { key: "continue", label: "Teruskan", variant: "default" },
  { key: "increase", label: "Tambah Porsi", variant: "default" },
  { key: "test", label: "Coba Kombinasi Baru", variant: "outline" },
  { key: "reduce", label: "Kurangi", variant: "secondary" },
  { key: "stop", label: "Hentikan", variant: "destructive" },
];

function BreakdownList({ title, items }: { title: string; items: PerformanceBreakdown[] }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-2">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Belum ada data.</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((b) => (
            <div key={b.label} className="flex items-center justify-between text-sm">
              <span className="truncate">{b.label}</span>
              <span className="tabular-nums text-muted-foreground shrink-0 ml-2">
                {b.avgViews.toLocaleString("id-ID")} views ({b.count})
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Laporan Bulanan (2026-08-19, PRD §31-33, scope dikurangi - §34 SWOT Update TIDAK ada,
// lihat monthlyReportData.ts). Beda dari WeeklyReport: ada rekomendasi strategis dari AI
// (Continue/Reduce/Stop/Increase/Test) berdasar breakdown performa nyata, BUKAN cuma
// ranking. Panggil AI tiap load (belum di-cache, lihat catatan biaya di route.ts) -
// loading time lebih lama dari WeeklyReport, wajar.
export function MonthlyReport({ brandId }: { brandId: string }) {
  const [days, setDays] = useState(30);
  const { data, loading } = useFetchedData<MonthlyReportData>(
    () => fetch(`/api/brands/${brandId}/monthly-report?days=${days}`).then((res) => res.json()),
    [brandId, days]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant={days === 30 ? "default" : "outline"} size="sm" onClick={() => setDays(30)}>30 hari</Button>
          <Button variant={days === 90 ? "default" : "outline"} size="sm" onClick={() => setDays(90)}>90 hari</Button>
        </div>
        <a href={`/api/brands/${brandId}/monthly-report/pdf?days=${days}`} download>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Download className="w-3.5 h-3.5" /> Unduh PDF
          </Button>
        </a>
      </div>

      {loading || !data ? (
        <p className="text-sm text-muted-foreground">Memuat (termasuk analisis AI, bisa beberapa detik)...</p>
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle>Ringkasan Eksekutif</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-2xl font-semibold tabular-nums">{data.totalContent}</p>
                  <p className="text-xs text-muted-foreground">Total Konten Tayang</p>
                </div>
                <div>
                  <p className="text-2xl font-semibold tabular-nums">{data.totalViews.toLocaleString("id-ID")}</p>
                  <p className="text-xs text-muted-foreground">Total Views</p>
                </div>
                <div>
                  <p className="text-2xl font-semibold tabular-nums">{data.avgEngagementRate !== null ? `${data.avgEngagementRate.toFixed(2)}%` : "-"}</p>
                  <p className="text-xs text-muted-foreground">Rata-rata Engagement</p>
                </div>
              </div>
              {data.bestContent && (
                <p className="text-xs text-muted-foreground">
                  🏆 Terbaik: {data.bestContent.captionSnippet} ({data.bestContent.views.toLocaleString("id-ID")} views)
                </p>
              )}
              {data.worstContent && (
                <p className="text-xs text-muted-foreground">
                  📉 Terlemah: {data.worstContent.captionSnippet} ({data.worstContent.views.toLocaleString("id-ID")} views)
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Analisis Performa</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <BreakdownList title="Per Tipe Konten" items={data.byContentType} />
              <BreakdownList title="Per Pilar" items={data.byPillar} />
              <BreakdownList title="Per Tipe Hook" items={data.byHookType} />
              <BreakdownList title="Per Struktur Video" items={data.byStructure} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Rekomendasi Strategis (AI)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {RECO_META.map(({ key, label, variant }) => (
                <div key={key}>
                  <Badge variant={variant} className="mb-2">{label}</Badge>
                  {data.recommendation[key].length === 0 ? (
                    <p className="text-xs text-muted-foreground">Tidak ada.</p>
                  ) : (
                    <ul className="text-sm space-y-1 list-disc list-inside">
                      {data.recommendation[key].map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
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
