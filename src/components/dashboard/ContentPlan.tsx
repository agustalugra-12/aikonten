"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type PlanRow = {
  id: string;
  kind: "idea" | "project";
  date: string;
  contentType: string | null;
  pillar: string | null;
  topicOrHook: string;
  structure: string | null;
  status: string;
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
};

// Content Planning Engine (2026-08-19, PRD §22-23) - tabel kronologis gabungan ide
// (belum diproduksi) + konten (sudah/sedang diproduksi), pengganti sementara tampilan
// tabel "Date/Content Type/Pillar/Topic/Hook/Structure/Status" yang diminta PRD. SWOT/
// Competitor Analysis sebagai input planning BELUM ada (blocked keputusan bisnis) -
// lihat catatan lengkap di API route content-plan/route.ts.
export function ContentPlan({ brandId }: { brandId: string }) {
  const [days, setDays] = useState(14);
  const [rows, setRows] = useState<PlanRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/brands/${brandId}/content-plan?days=${days}`)
      .then((res) => res.json())
      .then((data) => setRows(data.rows))
      .finally(() => setLoading(false));
  }, [brandId, days]);

  return (
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
                    <td className="py-2 pr-3">{r.contentType || "-"}</td>
                    <td className="py-2 pr-3">{r.pillar || "-"}</td>
                    <td className="py-2 pr-3 max-w-xs truncate" title={r.topicOrHook}>{r.topicOrHook || "-"}</td>
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
  );
}
