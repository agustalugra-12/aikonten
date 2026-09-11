"use client";

import { useMemo, useState } from "react";
import { useFetchedData } from "@/lib/useFetchedData";
import { WeeklyReport } from "@/components/dashboard/WeeklyReport";
import { MonthlyReport } from "@/components/dashboard/MonthlyReport";
import type { SocialAccount } from "@/types";

// Analytics - port Stitch (2026-09-12, PRD). Data NYATA: agregat dari dashboard-stats +
// per-akun dari /analytics (Buffer). Yg TIDAK ada di backend (top-content by views,
// format-breakdown per-format) SENGAJA di-omit (bukan angka palsu). Laporan PDF/CSV
// existing (WeeklyReport/MonthlyReport) di-reuse di bawah. Chart SVG gaya mockup.

type Metric = { name: string; value: number; unit: string; type: string };
type AnalyticsRow = { id: string; platform: SocialAccount["platform"]; username: string; available: boolean; metrics?: Metric[]; error?: string };
type DashboardStats = {
  publishedThisWeek: number;
  publishedThisWeekDeltaPercent: number;
  dailyActivity: { date: string; count: number }[];
  platformDistribution: { platform: string; count: number }[];
};

const PLATFORM_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", tiktok: "TikTok" };
const DAY_ID = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const DONUT_SHADES = ["#000000", "#555f6d", "#a0a0aa", "#c6c6cd", "#dce2f3"];

function metricVal(row: AnalyticsRow, name: string): number | null {
  const m = row.metrics?.find((x) => x.name === name);
  return m ? m.value : null;
}
function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return Math.round(n).toLocaleString("id-ID");
}
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return pts[0] ? `M ${pts[0].x},${pts[0].y}` : "";
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += ` C ${p1.x + (p2.x - p0.x) / 6},${p1.y + (p2.y - p0.y) / 6} ${p2.x - (p3.x - p1.x) / 6},${p2.y - (p3.y - p1.y) / 6} ${p2.x},${p2.y}`;
  }
  return d;
}

export function Analytics({ brandId }: { brandId: string }) {
  const [tab, setTab] = useState<"mingguan" | "bulanan">("mingguan");
  const { data: rows } = useFetchedData<AnalyticsRow[]>(() => fetch(`/api/brands/${brandId}/analytics`).then((r) => r.json()), [brandId]);
  const { data: stats } = useFetchedData<DashboardStats | null>(() => fetch(`/api/brands/${brandId}/dashboard-stats`).then((r) => r.json()), [brandId]);

  const agg = useMemo(() => {
    const avail = (rows || []).filter((r) => r.available && r.metrics);
    const sum = (name: string) => avail.reduce((s, r) => s + (metricVal(r, name) ?? 0), 0);
    const engVals = avail.map((r) => metricVal(r, "engagementRate")).filter((v): v is number => v != null);
    return {
      views: avail.some((r) => metricVal(r, "views") != null) ? sum("views") : null,
      reach: avail.some((r) => metricVal(r, "reach") != null) ? sum("reach") : null,
      shares: avail.some((r) => metricVal(r, "shares") != null) ? sum("shares") : null,
      eng: engVals.length ? engVals.reduce((a, b) => a + b, 0) / engVals.length : null,
      hasChannels: avail.length > 0,
    };
  }, [rows]);

  const chart = (stats?.dailyActivity || []).map((d) => ({ label: DAY_ID[new Date(d.date).getDay()], count: d.count }));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-[#151c27]">Analytics</h1>
        <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-[#e7eefe] text-[#151c27]">Live Telemetry</span>
      </div>

      {/* Metric panels */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Panel label="Publish (minggu ini)" value={stats ? String(stats.publishedThisWeek) : "…"} sub={stats ? `${stats.publishedThisWeekDeltaPercent >= 0 ? "+" : ""}${stats.publishedThisWeekDeltaPercent}% vs lalu` : ""} icon="task_alt" />
        <Panel label="Total Views" value={agg.views != null ? fmtNum(agg.views) : "—"} sub={agg.views != null ? "dari kanal Buffer" : "belum ada data"} icon="visibility" />
        <Panel label="Total Reach" value={agg.reach != null ? fmtNum(agg.reach) : "—"} sub={agg.reach != null ? "akuisisi unik" : "belum ada data"} icon="hub" />
        <Panel label="Avg Engagement" value={agg.eng != null ? agg.eng.toFixed(2) + "%" : "—"} sub={agg.shares != null ? `${fmtNum(agg.shares)} shares` : "belum ada data"} icon="favorite" />
      </div>

      {/* Chart + donut */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl bg-white ring-1 ring-[#e7eefe] shadow-sm p-4">
          <p className="font-heading text-sm font-semibold text-[#151c27] mb-3">Aktivitas Publish (7 Hari)</p>
          {stats && chart.length > 0 ? <AreaChart data={chart} /> : <p className="h-40 flex items-center justify-center text-[13px] text-[#555f6d]">Memuat...</p>}
        </div>
        <div className="rounded-xl bg-white ring-1 ring-[#e7eefe] shadow-sm p-4">
          <p className="font-heading text-sm font-semibold text-[#151c27] mb-3">Distribusi Platform (30 Hari)</p>
          {stats && stats.platformDistribution.length > 0 ? <Donut data={stats.platformDistribution} /> : <p className="h-40 flex items-center justify-center text-[13px] text-[#555f6d]">{stats ? "Belum ada publish." : "Memuat..."}</p>}
        </div>
      </div>

      {/* Per-channel performance */}
      <div className="rounded-xl bg-white ring-1 ring-[#e7eefe] shadow-sm p-4">
        <p className="font-heading text-sm font-semibold text-[#151c27] mb-3">Performa per Saluran</p>
        {!rows ? (
          <p className="text-[13px] text-[#555f6d] py-6 text-center">Memuat...</p>
        ) : !agg.hasChannels ? (
          <p className="text-[13px] text-[#555f6d] py-6 text-center">Belum ada data analitik kanal (butuh akun tersambung via Buffer).</p>
        ) : (
          <div className="space-y-3">
            {(() => {
              const avail = rows.filter((r) => r.available && r.metrics);
              const maxViews = Math.max(1, ...avail.map((r) => metricVal(r, "views") ?? 0));
              return avail.map((r) => {
                const v = metricVal(r, "views") ?? 0;
                const eng = metricVal(r, "engagementRate");
                return (
                  <div key={r.id}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[13px] font-medium text-[#151c27] flex items-center gap-1.5">
                        <span className="w-6 h-6 rounded bg-[#f0f3ff] flex items-center justify-center text-[10px] font-bold">{(PLATFORM_LABEL[r.platform] || r.platform).slice(0, 2).toUpperCase()}</span>
                        {PLATFORM_LABEL[r.platform] || r.platform}
                      </span>
                      <span className="font-mono text-[12px] text-[#555f6d]">{fmtNum(v)} views{eng != null ? ` · ${eng.toFixed(1)}%` : ""}</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-[#f0f3ff] overflow-hidden">
                      <div className="h-full rounded-full bg-black" style={{ width: `${Math.round((v / maxViews) * 100)}%` }} />
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        )}
      </div>

      {/* Laporan PDF/CSV (reuse existing) */}
      <div className="rounded-xl bg-white ring-1 ring-[#e7eefe] shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <p className="font-heading text-sm font-semibold text-[#151c27]">Laporan</p>
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[#f0f3ff]">
            {(["mingguan", "bulanan"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={"px-3 py-1 rounded-md text-[12px] font-medium capitalize " + (tab === t ? "bg-black text-white" : "text-[#555f6d]")}>{t}</button>
            ))}
          </div>
        </div>
        {tab === "mingguan" ? <WeeklyReport brandId={brandId} /> : <MonthlyReport brandId={brandId} />}
      </div>
    </div>
  );
}

function Panel({ label, value, sub, icon }: { label: string; value: string; sub: string; icon: string }) {
  return (
    <div className="rounded-xl bg-white ring-1 ring-[#e7eefe] shadow-sm p-4">
      <div className="flex items-start justify-between">
        <span className="text-[11px] uppercase tracking-wider text-[#555f6d] font-medium">{label}</span>
        <span className="material-symbols-outlined text-[18px] text-[#555f6d]">{icon}</span>
      </div>
      <p className="font-heading text-2xl font-bold tabular-nums mt-2 text-[#151c27] leading-none">{value}</p>
      <p className="text-[11px] text-[#555f6d] mt-1.5">{sub}</p>
    </div>
  );
}

function AreaChart({ data }: { data: { label: string; count: number }[] }) {
  const W = 700, H = 180, pad = 16;
  const max = Math.max(1, ...data.map((d) => d.count));
  const n = data.length;
  const pts = data.map((d, i) => ({ x: n === 1 ? W / 2 : (i / (n - 1)) * W, y: H - pad - (d.count / max) * (H - pad * 2) }));
  const line = smoothPath(pts);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40" preserveAspectRatio="none">
        <defs><linearGradient id="anaGrad" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#000" stopOpacity="0.14" /><stop offset="100%" stopColor="#000" stopOpacity="0" /></linearGradient></defs>
        {[0.25, 0.5, 0.75, 1].map((f, i) => <line key={i} x1="0" x2={W} y1={H * f} y2={H * f} stroke="#dce2f3" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />)}
        {line && <path d={`${line} L ${W},${H} L 0,${H} Z`} fill="url(#anaGrad)" />}
        {line && <path d={line} fill="none" stroke="#000" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
        {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="3.5" fill="#fff" stroke="#000" strokeWidth="2" vectorEffect="non-scaling-stroke" />)}
      </svg>
      <div className="flex justify-between mt-2 font-mono text-[11px] text-[#555f6d]">{data.map((d, i) => <span key={i}>{d.label}</span>)}</div>
    </div>
  );
}

function Donut({ data }: { data: { platform: string; count: number }[] }) {
  const total = Math.max(1, data.reduce((s, d) => s + d.count, 0));
  const R = 40, C = 2 * Math.PI * R;
  let acc = 0;
  const segs = data.map((d, i) => { const len = (d.count / total) * C; const s = { len, off: -acc, shade: DONUT_SHADES[i % DONUT_SHADES.length], platform: d.platform, count: d.count }; acc += len; return s; });
  return (
    <div className="flex items-center justify-center gap-6 h-40">
      <div className="relative w-28 h-28 shrink-0">
        <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={R} fill="none" stroke="#e7eefe" strokeWidth="12" />
          {segs.map((s, i) => <circle key={i} cx="50" cy="50" r={R} fill="none" stroke={s.shade} strokeWidth="12" strokeDasharray={`${s.len} ${C - s.len}`} strokeDashoffset={s.off} />)}
        </svg>
      </div>
      <div className="space-y-1.5">
        {segs.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-[13px] text-[#151c27]">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.shade }} />
            <span className="capitalize">{PLATFORM_LABEL[s.platform] || s.platform}</span>
            <span className="font-mono text-[11px] text-[#555f6d] ml-auto tabular-nums">{s.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
