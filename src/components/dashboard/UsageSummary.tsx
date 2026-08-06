"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type UsageByModel = { model: string; calls: number; totalTokens: number | null; costUsd: number };
type UsageSummaryData = { totalCostToday: number; byModel: UsageByModel[] };

// Transparansi biaya AI (2026-08-06, permintaan Agus - "cek ai blok dan ai konten juga
// agar transparan") - sama semangat dgn panel serupa yg sudah ditambahkan hari yg sama
// di ai-chat-bot (Analytics.jsx) & AI Blog (CmsBlog.jsx) - biar Agus bisa lihat dari
// dalam app, bukan baru ketahuan dari dashboard OpenAI/fal.ai setelah kejadian.
export function UsageSummary() {
  const [data, setData] = useState<UsageSummaryData | null>(null);

  useEffect(() => {
    fetch("/api/usage-summary")
      .then((res) => res.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data || data.totalCostToday === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Biaya AI KontenPilot Hari Ini</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-2xl font-semibold tabular-nums">${data.totalCostToday.toFixed(4)}</p>
        <p className="text-xs text-muted-foreground">
          OpenAI saja (teks/vision/Whisper/TTS) - biaya fal.ai (poster/foto) belum termasuk, dicek terpisah lewat dashboard fal.ai.
        </p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {data.byModel
            .sort((a, b) => b.costUsd - a.costUsd)
            .map((m) => (
              <Badge key={m.model} variant="secondary" className="text-xs">
                {m.model}: ${m.costUsd.toFixed(4)} ({m.calls}x)
              </Badge>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}
