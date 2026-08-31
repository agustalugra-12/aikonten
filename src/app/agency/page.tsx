"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AgencyBrandSummary } from "@/lib/agency/aggregate";

// Agency Dashboard (2026-08-26, PRD §32, Task Plan 4) - LAYER BARU di ATAS dashboard
// per-brand yang sudah ada (page.tsx + Sidebar.tsx TIDAK disentuh sama sekali) - view
// portfolio lintas-brand utk Agus liat semua brand sekaligus (Pelangi/Harmoni dari server
// ini + Laundry In Bali/Animal Story dari server satunya kalau dikonfigurasi
// AGENCY_PEER_URLS). Reuse 100% data dari getWeeklyReportData (Plan 3) - tidak ada
// panggilan AI baru sama sekali, murni agregasi data yang sudah dihitung.
const STATUS_LABEL: Record<string, string> = {
  published: "Tayang", ready: "Draft Siap", processing: "Diproses", uploaded: "Baru Upload",
  publishing: "Sedang Tayang", partial: "Sebagian Gagal", failed: "Gagal", scheduled: "Terjadwal",
};

export default function AgencyDashboardPage() {
  const [brands, setBrands] = useState<AgencyBrandSummary[] | null>(null);
  const [peerErrors, setPeerErrors] = useState<{ source: string; error: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/agency/dashboard")
      .then((res) => res.json())
      .then((data) => {
        setBrands(data.brands || []);
        setPeerErrors(data.peerErrors || []);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Memuat ringkasan agency...</div>;
  }

  return (
    <div className="p-6 max-w-5xl w-full mx-auto space-y-4">
      <div>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">&larr; Kembali ke Dashboard</Link>
        <h1 className="text-xl font-semibold mt-1">Agency Dashboard</h1>
        <p className="text-sm text-muted-foreground">Ringkasan seluruh brand - portfolio, pipeline, performa 7 hari.</p>
      </div>

      {peerErrors.length > 0 && (
        <Card className="border-yellow-500/50">
          <CardContent className="p-4 text-sm text-yellow-700">
            Sebagian server tidak bisa dihubungi ({peerErrors.map((e) => e.source).join(", ")}) - brand di server itu
            sementara tidak tampil, data brand lain di bawah tetap akurat.
          </CardContent>
        </Card>
      )}

      {!brands || brands.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada data brand.</p>
      ) : (
        brands.map((b) => (
          <Card key={b.brandId}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
                <span>{b.brandName}</span>
                <span className="text-sm font-normal text-muted-foreground">{b.totalContentAllTime} konten total</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1">
                {Object.entries(b.statusCounts).map(([status, count]) => (
                  <Badge key={status} variant="outline">{STATUS_LABEL[status] || status}: {count}</Badge>
                ))}
              </div>

              <div className="text-sm">
                <span className="text-muted-foreground">7 hari terakhir: </span>
                <span className="font-medium">{b.weekly.totalPublished} konten tayang</span>
              </div>

              {b.weekly.byPlatform.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {b.weekly.byPlatform.map((p) => (
                    <Badge key={p.platform} variant="secondary" className="text-xs">
                      {p.platform}: ~{p.avgViews} views ({p.count}x)
                    </Badge>
                  ))}
                </div>
              )}

              {b.weekly.topContent[0] && (
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Top performer ({b.weekly.topContent[0].platform}): </span>
                  {b.weekly.topContent[0].captionSnippet}
                  {b.weekly.topContent[0].multiplier != null && ` (${b.weekly.topContent[0].multiplier}x baseline)`}
                </div>
              )}
              {b.weekly.underperformingContent[0] && (
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Perlu perhatian ({b.weekly.underperformingContent[0].platform}): </span>
                  {b.weekly.underperformingContent[0].captionSnippet}
                  {b.weekly.underperformingContent[0].multiplier != null && ` (${b.weekly.underperformingContent[0].multiplier}x baseline)`}
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
