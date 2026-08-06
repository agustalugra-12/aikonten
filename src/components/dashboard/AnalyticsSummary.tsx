"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SocialAccount } from "@/types";

type Metric = { name: string; value: number; unit: string; type: string };
type AnalyticsRow = {
  id: string;
  platform: SocialAccount["platform"];
  username: string;
  available: boolean;
  metrics?: Metric[];
  error?: string;
};

const PLATFORM_LABEL: Record<SocialAccount["platform"], string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  tiktok: "TikTok",
};

// Metrik yg ditampilkan & urutannya - lihat memory proyek: hasil introspeksi nyata ke
// API Buffer utk nama field ini (views/reach/reactions/shares/engagementRate).
const METRIC_ORDER = ["views", "reach", "reactions", "shares", "engagementRate"];

function formatValue(m: Metric): string {
  if (m.unit === "percentage") return `${m.value.toFixed(2)}%`;
  return Math.round(m.value).toLocaleString("id-ID");
}

// Analitik "ambil dari Buffer saja" (keputusan Agus) - cuma berlaku utk akun yg
// tersambung via Buffer (TikTok/Instagram sekarang). Akun native (YouTube nanti)
// ditampilkan sbg "belum ada data", bukan disembunyikan begitu saja - biar Agus tau
// kenapa datanya kosong.
export function AnalyticsSummary({ brandId }: { brandId: string }) {
  const [rows, setRows] = useState<AnalyticsRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/brands/${brandId}/analytics`)
      .then((res) => res.json())
      .then(setRows)
      .finally(() => setLoading(false));
  }, [brandId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Analitik (30 hari terakhir)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Memuat...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada akun tersambung utk brand ini.</p>
        ) : (
          rows.map((row) => (
            <div key={row.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{PLATFORM_LABEL[row.platform]}</Badge>
                <span className="text-sm">@{row.username}</span>
              </div>
              {!row.available ? (
                <p className="text-xs text-muted-foreground">
                  Belum ada data analitik utk akun ini{row.error ? ` (${row.error})` : ""}.
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {METRIC_ORDER.map((type) => {
                    const m = row.metrics?.find((x) => x.type === type);
                    if (!m) return null;
                    return (
                      <div key={type}>
                        <p className="text-lg font-semibold tabular-nums">{formatValue(m)}</p>
                        <p className="text-xs text-muted-foreground">{m.name}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
