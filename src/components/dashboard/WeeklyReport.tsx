"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

type TopContent = {
  id: string;
  pillar: string | null;
  angle: string | null;
  captionSnippet: string;
  views: number | null;
  engagementRate: number | null;
  publishedAt: string | null;
};

type ReportData = {
  windowDays: number;
  windowStart: string;
  totalPublished: number;
  byPillar: { pillar: string; count: number }[];
  topContent: TopContent[];
  topContentDataAvailable: boolean;
};

const WINDOW_OPTIONS = [
  { days: 7, label: "7 hari" },
  { days: 30, label: "30 hari" },
  { days: 90, label: "90 hari" },
];

// Laporan mingguan in-app (2026-08-19, PRD "AI Content Intelligence" §25-34) - langkah
// pertama dari fitur Analytics/Reporting yg lebih besar (lihat
// docs/HANDOFF_OPENCODE_2026-08-18.md utk roadmap lengkap: grafik tren & PDF export
// MENYUSUL, belum di sini - keduanya butuh fondasi lain yg belum siap [data `analytics`
// baru mulai terkumpul & belum pilih library PDF]). Ini SENGAJA cuma ringkasan +
// ranking, bukan grafik - data yg dipakai (performanceViews/performanceEngagementRate)
// SUDAH ada sekarang, tidak perlu nunggu apa pun.
export function WeeklyReport({ brandId }: { brandId: string }) {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/brands/${brandId}/weekly-report?days=${days}`)
      .then((res) => res.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [brandId, days]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
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
        {/* Download PDF (2026-08-19) - <a download> langsung ke endpoint PDF, bukan fetch+
            blob di client - lebih sederhana & browser yg urus proses download-nya sendiri. */}
        <a href={`/api/brands/${brandId}/weekly-report/pdf?days=${days}`} download>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Download className="w-3.5 h-3.5" /> Unduh PDF
          </Button>
        </a>
      </div>

      {loading || !data ? (
        <p className="text-sm text-muted-foreground">Memuat...</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Ringkasan Aktivitas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">
                <span className="text-2xl font-semibold tabular-nums">{data.totalPublished}</span>{" "}
                <span className="text-muted-foreground">konten tayang dalam {data.windowDays} hari terakhir</span>
              </p>
              {data.byPillar.length === 0 ? (
                <p className="text-xs text-muted-foreground">Belum ada konten tayang di jendela waktu ini.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {data.byPillar.map((p) => (
                    <Badge key={p.pillar} variant="outline">
                      {p.pillar}: {p.count}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>5 Konten Terbaik (berdasar views)</CardTitle>
            </CardHeader>
            <CardContent>
              {!data.topContentDataAvailable ? (
                <p className="text-sm text-muted-foreground">
                  Belum ada data performa (views) utk konten di jendela waktu ini - data disinkron
                  bertahap dari Buffer, coba lagi nanti atau perluas jendela waktunya.
                </p>
              ) : data.topContent.length === 0 ? (
                <p className="text-sm text-muted-foreground">Tidak ada konten dgn data performa di jendela ini.</p>
              ) : (
                <ol className="space-y-3">
                  {data.topContent.map((c, i) => (
                    <li key={c.id} className="flex items-start gap-3 rounded-lg border p-3">
                      <span className="text-lg font-semibold text-muted-foreground w-5 shrink-0 tabular-nums">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {c.pillar && <Badge variant="outline">{c.pillar}</Badge>}
                          {c.angle && <Badge variant="outline">{c.angle}</Badge>}
                        </div>
                        {c.captionSnippet && (
                          <p className="text-sm text-muted-foreground line-clamp-2">{c.captionSnippet}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-semibold tabular-nums">{c.views?.toLocaleString("id-ID")} views</p>
                        {c.engagementRate !== null && (
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {c.engagementRate.toFixed(2)}% engagement
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
