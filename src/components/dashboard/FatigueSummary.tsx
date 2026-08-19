"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type FatigueResult = {
  topic: string;
  usageCount: number;
  avgViews: number;
  avgEngagement: number;
  trend: "increasing" | "decreasing" | "stable";
  recommendation: "continue" | "reduce" | "rotate";
};

const RECOMMENDATION_LABELS: Record<string, string> = {
  continue: "Lanjutkan",
  reduce: "Kurangi Frekuensi",
  rotate: "Ganti Topik",
};

const RECOMMENDATION_COLORS: Record<string, string> = {
  continue: "bg-green-100 text-green-800",
  reduce: "bg-yellow-100 text-yellow-800",
  rotate: "bg-red-100 text-red-800",
};

const TREND_LABELS: Record<string, string> = {
  increasing: "↑ Meningkat",
  decreasing: "↓ Menurun",
  stable: "→ Stabil",
};

export function FatigueSummary({ brandId }: { brandId: string }) {
  const [fatigue, setFatigue] = useState<FatigueResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/brands/${brandId}/fatigue`)
      .then((res) => res.json())
      .then((data) => setFatigue(Array.isArray(data) ? data : []))
      .catch(() => setFatigue([]))
      .finally(() => setLoading(false));
  }, [brandId]);

  const hasFatigue = fatigue.some((f) => f.recommendation !== "continue");

  if (loading || fatigue.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Content Fatigue Detection</CardTitle>
        <CardDescription>Topik yang overused dengan performa menurun (30 hari terakhir)</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {fatigue.slice(0, 5).map((f) => (
            <div key={f.topic} className="flex items-center justify-between gap-2 text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium truncate">{f.topic}</span>
                <span className="text-muted-foreground shrink-0">{f.usageCount}x</span>
                <span className="text-muted-foreground shrink-0">{TREND_LABELS[f.trend]}</span>
              </div>
              <Badge className={`shrink-0 ${RECOMMENDATION_COLORS[f.recommendation]}`}>
                {RECOMMENDATION_LABELS[f.recommendation]}
              </Badge>
            </div>
          ))}
        </div>
        {!hasFatigue && (
          <p className="text-xs text-muted-foreground mt-2">Semua topik masih dalam batas normal.</p>
        )}
      </CardContent>
    </Card>
  );
}
