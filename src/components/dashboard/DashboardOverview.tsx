"use client";


import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProjectList } from "@/components/dashboard/ProjectList";
import { Send, FileClock, Wallet, Flame, TrendingUp, TrendingDown } from "lucide-react";
import { useFetchedData } from "@/lib/useFetchedData";
import type { Brand, Project, SocialAccount } from "@/types";

type DashboardStats = {
  publishedThisWeek: number;
  publishedThisWeekDeltaPercent: number;
  draftCount: number;
  costThisMonth: number;
  streak: number;
  dailyActivity: { date: string; count: number }[];
  platformDistribution: { platform: string; count: number }[];
};

const DAY_LABEL_ID = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
// Shade donut - grayscale, mengikuti mockok (primary hitam -> abu -> outline-variant).
const DONUT_SHADES = ["#000000", "#555f6d", "#a0a0aa", "#c6c6cd", "#dce2f3"];

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

// Path mulus (Catmull-Rom -> cubic bezier) utk grafik garis - meniru kurva halus chart
// mockup (bukan garis patah recharts). vectorEffect non-scaling-stroke dipakai di
// pemanggil supaya tebal garis tetap walau SVG di-stretch responsif.
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x},${pts[0].y}`;
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
  }
  return d;
}

// Grafik AREA + GARIS gaya mockup KontenPilot (2026-09-11): isian gradient di bawah
// garis, grid horizontal putus-putus, titik penanda di tiap data. Data nyata dari
// dailyActivity. Monokrom (token mockup). Pengganti BarChart recharts sebelumnya.
function ActivityAreaChart({ data }: { data: { label: string; count: number }[] }) {
  const W = 700;
  const H = 200;
  const padY = 16;
  const max = Math.max(1, ...data.map((d) => d.count));
  const n = data.length;
  const pts = data.map((d, i) => ({
    x: n === 1 ? W / 2 : (i / (n - 1)) * W,
    y: H - padY - (d.count / max) * (H - padY * 2),
  }));
  const line = smoothPath(pts);
  const area = pts.length > 0 ? `${line} L ${W},${H} L 0,${H} Z` : "";
  const grid = [0.2, 0.4, 0.6, 0.8, 1].map((f) => H * f);

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-48" preserveAspectRatio="none">
        <defs>
          <linearGradient id="kpAreaGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#000000" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </linearGradient>
        </defs>
        {grid.map((y, i) => (
          <line key={i} x1="0" x2={W} y1={y} y2={y} stroke="#dce2f3" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        ))}
        {area && <path d={area} fill="url(#kpAreaGrad)" />}
        {line && <path d={line} fill="none" stroke="#000000" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3.5" fill="#ffffff" stroke="#000000" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="flex justify-between mt-2 font-mono text-[11px] text-[#555f6d]">
        {data.map((d, i) => (
          <span key={i}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}

// Donut SVG gaya mockup (stroke-dasharray pd lingkaran) - pengganti PieChart recharts.
function PlatformDonut({ data }: { data: { platform: string; count: number }[] }) {
  const total = Math.max(1, data.reduce((s, d) => s + d.count, 0));
  const R = 40;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const segs = data.map((d, i) => {
    const len = (d.count / total) * C;
    const seg = { len, offset: -acc, shade: DONUT_SHADES[i % DONUT_SHADES.length], platform: d.platform, count: d.count };
    acc += len;
    return seg;
  });
  const topPct = Math.round((data[0]?.count ?? 0) / total * 100);

  return (
    <div className="flex items-center justify-center gap-6 h-48">
      <div className="relative w-32 h-32 shrink-0">
        <svg className="w-32 h-32 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={R} fill="none" stroke="#e7eefe" strokeWidth="12" />
          {segs.map((s, i) => (
            <circle
              key={i}
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke={s.shade}
              strokeWidth="12"
              strokeDasharray={`${s.len} ${C - s.len}`}
              strokeDashoffset={s.offset}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-heading font-semibold text-lg text-[#151c27] leading-none">{topPct}%</span>
          <span className="text-[10px] uppercase tracking-wider text-[#555f6d] mt-0.5">{data[0]?.platform || ""}</span>
        </div>
      </div>
      <div className="space-y-1.5">
        {segs.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-[13px] text-[#151c27]">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.shade }} />
            <span className="capitalize">{s.platform}</span>
            <span className="font-mono text-[11px] text-[#555f6d] ml-auto tabular-nums">{s.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardOverview({
  brand,
  projects,
  accounts,
  onRetryProject,
}: {
  brand: Brand | null;
  projects: Project[];
  accounts: SocialAccount[];
  onRetryProject: () => void;
}) {
  const { data: stats } = useFetchedData<DashboardStats | null>(
    () => (brand?.id ? fetch(`/api/brands/${brand.id}/dashboard-stats`).then((res) => res.json()) : Promise.resolve(null)),
    [brand?.id]
  );

  const jamSekarang = new Date().getHours();
  const sapaan = jamSekarang < 11 ? "Selamat pagi" : jamSekarang < 15 ? "Selamat siang" : jamSekarang < 18 ? "Selamat sore" : "Selamat malam";

  const chartData = (stats?.dailyActivity || []).map((d) => ({
    label: DAY_LABEL_ID[new Date(d.date).getDay()],
    count: d.count,
  }));

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-black text-white p-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="font-heading text-lg font-semibold">{sapaan}! 👋</p>
          <p className="text-sm text-white/70 mt-0.5">
            {brand ? `Ringkasan aktivitas konten ${brand.name} minggu ini.` : "Pilih brand utk lihat ringkasan."}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Send} label="Dipublikasikan" value={stats ? String(stats.publishedThisWeek) : "…"} trend={stats ? stats.publishedThisWeekDeltaPercent : null} sub="vs minggu lalu" />
        <StatCard icon={FileClock} label="Draft Menunggu" value={stats ? String(stats.draftCount) : "…"} sub="siap direview" />
        <StatCard icon={Wallet} label="Biaya AI Bulan Ini" value={stats ? formatUsd(stats.costThisMonth) : "…"} sub="OpenAI + Gemini" />
        <StatCard icon={Flame} label="Hari Beruntun" value={stats ? String(stats.streak) : "…"} sub="publish tiap hari" />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-sm font-semibold">Aktivitas Publish (7 Hari)</CardTitle>
          </CardHeader>
          <CardContent>
            {stats && chartData.length > 0 ? (
              <ActivityAreaChart data={chartData} />
            ) : (
              <p className="text-sm text-muted-foreground h-48 flex items-center justify-center">Memuat...</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-sm font-semibold">Distribusi Platform (30 Hari)</CardTitle>
          </CardHeader>
          <CardContent>
            {stats && stats.platformDistribution.length > 0 ? (
              <PlatformDonut data={stats.platformDistribution} />
            ) : (
              <p className="text-sm text-muted-foreground h-48 flex items-center justify-center">
                {stats ? "Belum ada publish 30 hari terakhir." : "Memuat..."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-sm font-semibold">Konten Terbaru</CardTitle>
        </CardHeader>
        <CardContent>
          <ProjectList projects={projects.slice(0, 5)} brand={brand} accounts={accounts} onRetry={onRetryProject} embedded />
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  trend = null,
}: {
  icon: typeof Send;
  label: string;
  value: string;
  sub: string;
  trend?: number | null;
}) {
  const TrendIcon = trend != null && trend < 0 ? TrendingDown : TrendingUp;
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</span>
          <Icon className="w-[18px] h-[18px] text-muted-foreground shrink-0" />
        </div>
        <p className="font-heading text-3xl font-semibold tabular-nums mt-2 leading-none">{value}</p>
        <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
          {trend != null && (
            <>
              <TrendIcon className="w-3.5 h-3.5 text-foreground" />
              <span className="font-medium text-foreground tabular-nums">
                {trend >= 0 ? "+" : ""}
                {trend}%
              </span>
            </>
          )}
          <span>{sub}</span>
        </div>
      </CardContent>
    </Card>
  );
}
