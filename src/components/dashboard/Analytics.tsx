"use client";

import { useState } from "react";
import { useFetchedData } from "@/lib/useFetchedData";
import { WeeklyReport } from "@/components/dashboard/WeeklyReport";
import { MonthlyReport } from "@/components/dashboard/MonthlyReport";

// Analytics - port Stitch (2026-09-12, PRD). Data NYATA: agregat dari dashboard-stats +
// per-akun dari /analytics (Buffer). Yg TIDAK ada di backend (top-content by views,
// format-breakdown per-format) SENGAJA di-omit (bukan angka palsu). Laporan PDF/CSV
// existing (WeeklyReport/MonthlyReport) di-reuse di bawah. Chart SVG gaya mockup.

type DashboardStats = {
  publishedThisWeek: number;
  publishedThisWeekDeltaPercent: number;
  dailyActivity: { date: string; count: number }[];
  platformDistribution: { platform: string; count: number }[];
};

const PLATFORM_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", tiktok: "TikTok" };
type TimeSeries = { days: number; daily: { date: string; views: number; likes: number; reach: number; eng: number | null }[]; byPlatform: { platform: string; views: number; likes: number }[]; hasReach: boolean; hasEng: boolean; totals: { views: number; likes: number; reach: number; eng: number | null }; prev: { views: number; likes: number } };
type PerfGroup = { key: string; n: number; avgViews: number; avgEng: number | null };
type ContentPerf = { totalScored: number; byType: PerfGroup[]; byPillar: PerfGroup[]; byHook: PerfGroup[]; topContent: { id: string; type: string; pillar: string | null; hook: string | null; title: string; views: number; eng: number | null }[] };
const DONUT_SHADES = ["#000000", "#555f6d", "#a0a0aa", "#c6c6cd", "#dce2f3"];

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
  const { data: stats } = useFetchedData<DashboardStats | null>(() => fetch(`/api/brands/${brandId}/dashboard-stats`).then((r) => r.json()), [brandId]);
  const { data: ts } = useFetchedData<TimeSeries | null>(() => fetch(`/api/brands/${brandId}/analytics/timeseries`).then((r) => r.json()), [brandId]);
  const { data: perf } = useFetchedData<ContentPerf | null>(() => fetch(`/api/brands/${brandId}/analytics/content-performance`).then((r) => r.json()), [brandId]);

  const viewsChart = (ts?.daily || []).map((d) => ({ label: d.date.slice(5), count: d.views }));
  const likesChart = (ts?.daily || []).map((d) => ({ label: d.date.slice(5), count: d.likes }));
  const vDelta = ts && ts.prev.views > 0 ? Math.round(((ts.totals.views - ts.prev.views) / ts.prev.views) * 100) : null;
  const reachChart = (ts?.daily || []).map((d) => ({ label: d.date.slice(5), count: d.reach }));
  const engChart = (ts?.daily || []).map((d) => ({ label: d.date.slice(5), count: d.eng ?? 0 }));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-[#151c27]">Analytics</h1>
        <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-[#e7eefe] text-[#151c27]">Live Telemetry</span>
      </div>

      {/* Metric panels */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Panel label="Publish (minggu ini)" value={stats ? String(stats.publishedThisWeek) : "…"} sub={stats ? `${stats.publishedThisWeekDeltaPercent >= 0 ? "+" : ""}${stats.publishedThisWeekDeltaPercent}% vs lalu` : ""} icon="task_alt" />
        <Panel label={`Total Views (${ts?.days ?? 30}h)`} value={ts ? fmtNum(ts.totals.views) : "…"} sub={vDelta != null ? `${vDelta >= 0 ? "+" : ""}${vDelta}% vs periode lalu` : "akumulasi harian"} icon="visibility" />
        <Panel label={`Total Likes (${ts?.days ?? 30}h)`} value={ts ? fmtNum(ts.totals.likes) : "…"} sub="reaksi terkumpul" icon="favorite" />
        <Panel label="Avg Engagement" value={ts?.totals.eng != null ? ts.totals.eng + "%" : "—"} sub={ts?.hasEng ? "rata-rata harian" : "mulai terkumpul 1 Nov"} icon="trending_up" />
      </div>

      {/* Chart + donut */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl bg-white ring-1 ring-[#e7eefe] shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="font-heading text-sm font-semibold text-[#151c27]">Tren Views ({ts?.days ?? 30} Hari)</p>
            {ts && <span className="text-[12px] font-mono text-[#555f6d] tabular-nums">{fmtNum(ts.totals.views)} total{vDelta != null ? ` · ${vDelta >= 0 ? "+" : ""}${vDelta}%` : ""}</span>}
          </div>
          {ts && viewsChart.length > 0 ? <AreaChart data={viewsChart} /> : <p className="h-40 flex items-center justify-center text-[13px] text-[#555f6d]">{ts ? "Belum ada data views." : "Memuat..."}</p>}
        </div>
        <div className="rounded-xl bg-white ring-1 ring-[#e7eefe] shadow-sm p-4">
          <p className="font-heading text-sm font-semibold text-[#151c27] mb-3">Distribusi Platform (30 Hari)</p>
          {stats && stats.platformDistribution.length > 0 ? <Donut data={stats.platformDistribution} /> : <p className="h-40 flex items-center justify-center text-[13px] text-[#555f6d]">{stats ? "Belum ada publish." : "Memuat..."}</p>}
        </div>
      </div>

      {/* Tren Likes + Views per platform (v1, data historis tabel analytics) */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl bg-white ring-1 ring-[#e7eefe] shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="font-heading text-sm font-semibold text-[#151c27]">Tren Likes ({ts?.days ?? 30} Hari)</p>
            {ts && <span className="text-[12px] font-mono text-[#555f6d] tabular-nums">{fmtNum(ts.totals.likes)} total</span>}
          </div>
          {ts && likesChart.length > 0 ? <AreaChart data={likesChart} /> : <p className="h-40 flex items-center justify-center text-[13px] text-[#555f6d]">{ts ? "Belum ada data likes." : "Memuat..."}</p>}
        </div>
        <div className="rounded-xl bg-white ring-1 ring-[#e7eefe] shadow-sm p-4">
          <p className="font-heading text-sm font-semibold text-[#151c27] mb-3">Views per Platform ({ts?.days ?? 30} Hari)</p>
          {ts && ts.byPlatform.length > 0 ? (
            <div className="space-y-2.5">
              {(() => { const mx = Math.max(1, ...ts.byPlatform.map((p) => p.views)); return ts.byPlatform.map((p) => (
                <div key={p.platform} className="space-y-1">
                  <div className="flex justify-between text-[12px]"><span className="capitalize text-[#151c27]">{PLATFORM_LABEL[p.platform] || p.platform}</span><span className="font-mono text-[#555f6d] tabular-nums">{fmtNum(p.views)} views · {fmtNum(p.likes)} likes</span></div>
                  <div className="h-2 rounded-full bg-[#e7eefe] overflow-hidden"><div className="h-full rounded-full bg-black" style={{ width: `${Math.round((p.views / mx) * 100)}%` }} /></div>
                </div>
              )); })()}
            </div>
          ) : <p className="h-40 flex items-center justify-center text-[13px] text-[#555f6d]">{ts ? "Belum ada data." : "Memuat..."}</p>}
        </div>
      </div>

      {/* Tren Reach + Engagement (v2 - mulai terkumpul 2026-11-01) */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl bg-white ring-1 ring-[#e7eefe] shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="font-heading text-sm font-semibold text-[#151c27]">Tren Reach ({ts?.days ?? 30} Hari)</p>
            {ts?.hasReach && <span className="text-[12px] font-mono text-[#555f6d] tabular-nums">{fmtNum(ts.totals.reach)} total</span>}
          </div>
          {ts?.hasReach && reachChart.length > 0 ? <AreaChart data={reachChart} /> : <p className="h-40 flex items-center justify-center text-center text-[13px] text-[#555f6d] px-4">{ts ? "Reach mulai dikumpulkan harian sejak 1 Nov — grafik terisi beberapa hari ke depan." : "Memuat..."}</p>}
        </div>
        <div className="rounded-xl bg-white ring-1 ring-[#e7eefe] shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="font-heading text-sm font-semibold text-[#151c27]">Tren Engagement ({ts?.days ?? 30} Hari)</p>
            {ts?.hasEng && ts.totals.eng != null && <span className="text-[12px] font-mono text-[#555f6d] tabular-nums">{ts.totals.eng}% rata-rata</span>}
          </div>
          {ts?.hasEng && engChart.length > 0 ? <AreaChart data={engChart} /> : <p className="h-40 flex items-center justify-center text-center text-[13px] text-[#555f6d] px-4">{ts ? "Engagement mulai dikumpulkan harian sejak 1 Nov — grafik terisi beberapa hari ke depan." : "Memuat..."}</p>}
        </div>
      </div>

      {/* Performa Konten per Tipe/Hook/Pilar + Top Content (v3) - dari projects.performanceViews */}
      {perf && perf.totalScored > 0 && (
        <div className="space-y-4">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="font-heading text-lg font-bold text-[#151c27]">Performa Konten</h2>
            <span className="text-[12px] text-[#555f6d]">dari {perf.totalScored} konten ber-metrik — mana yang paling perform (rata-rata views)</span>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <PerfCard title="Per Tipe Konten" groups={perf.byType} />
            <PerfCard title="Per Hook" groups={perf.byHook} />
            <PerfCard title="Per Pilar" groups={perf.byPillar} />
          </div>
          <div className="rounded-xl bg-white ring-1 ring-[#e7eefe] shadow-sm p-4">
            <p className="font-heading text-sm font-semibold text-[#151c27] mb-3">Top Konten (by Views)</p>
            <div className="space-y-2">
              {perf.topContent.map((c, i) => (
                <div key={c.id} className="flex items-center gap-3 text-[13px]">
                  <span className="font-mono text-[11px] text-[#555f6d] w-5 shrink-0">{i + 1}</span>
                  <span className="flex-1 truncate text-[#151c27]">{c.title}</span>
                  <span className="text-[11px] text-[#555f6d] capitalize shrink-0 hidden sm:inline">{c.type}{c.hook ? ` · ${c.hook}` : ""}</span>
                  <span className="font-mono text-[12px] text-[#151c27] tabular-nums shrink-0">{fmtNum(c.views)}{c.eng != null ? ` · ${c.eng}%` : ""}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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

function PerfCard({ title, groups }: { title: string; groups: PerfGroup[] }) {
  const top = groups.slice(0, 6);
  const mx = Math.max(1, ...top.map((g) => g.avgViews));
  return (
    <div className="rounded-xl bg-white ring-1 ring-[#e7eefe] shadow-sm p-4">
      <p className="font-heading text-sm font-semibold text-[#151c27] mb-3">{title}</p>
      {top.length === 0 ? (
        <p className="text-[13px] text-[#555f6d]">Belum ada data.</p>
      ) : (
        <div className="space-y-2.5">
          {top.map((g) => (
            <div key={g.key} className="space-y-1">
              <div className="flex justify-between text-[12px] gap-2">
                <span className="capitalize text-[#151c27] truncate">{g.key}</span>
                <span className="font-mono text-[#555f6d] tabular-nums shrink-0">{fmtNum(g.avgViews)} avg{g.avgEng != null ? ` · ${g.avgEng}%` : ""}</span>
              </div>
              <div className="h-2 rounded-full bg-[#e7eefe] overflow-hidden"><div className="h-full rounded-full bg-black" style={{ width: `${Math.round((g.avgViews / mx) * 100)}%` }} /></div>
              <div className="text-[10px] text-[#555f6d]">{g.n} konten</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AreaChart({ data }: { data: { label: string; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 700, H = 180, pad = 16;
  const max = Math.max(1, ...data.map((d) => d.count));
  const n = data.length;
  const pts = data.map((d, i) => ({ x: n === 1 ? W / 2 : (i / (n - 1)) * W, y: H - pad - (d.count / max) * (H - pad * 2) }));
  const line = smoothPath(pts);
  const slot = n > 1 ? W / (n - 1) : W;
  return (
    <div>
      <div className="relative" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40" preserveAspectRatio="none">
          <defs><linearGradient id="anaGrad" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#000" stopOpacity="0.14" /><stop offset="100%" stopColor="#000" stopOpacity="0" /></linearGradient></defs>
          {[0.25, 0.5, 0.75, 1].map((f, i) => <line key={i} x1="0" x2={W} y1={H * f} y2={H * f} stroke="#dce2f3" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />)}
          {line && <path d={`${line} L ${W},${H} L 0,${H} Z`} fill="url(#anaGrad)" />}
          {line && <path d={line} fill="none" stroke="#000" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
          {hover != null && pts[hover] && <line x1={pts[hover].x} x2={pts[hover].x} y1="0" y2={H} stroke="#c6c6cd" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
          {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={hover === i ? 5.5 : 3} fill={hover === i ? "#000" : "#fff"} stroke="#000" strokeWidth="2" vectorEffect="non-scaling-stroke" />)}
          {/* area hit transparan per titik -> hover munculkan tooltip angka (bukan deret label statis) */}
          {pts.map((p, i) => <rect key={"h" + i} x={p.x - slot / 2} y={0} width={slot} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />)}
        </svg>
        {hover != null && pts[hover] && (
          <div className="absolute z-10 pointer-events-none -translate-x-1/2 -translate-y-[130%] bg-black text-white text-[11px] font-mono rounded px-2 py-1 whitespace-nowrap tabular-nums shadow-lg" style={{ left: `${n > 1 ? (hover / (n - 1)) * 100 : 50}%`, top: `${(pts[hover].y / H) * 100}%` }}>
            {data[hover].label} · {fmtNum(data[hover].count)}
          </div>
        )}
      </div>
      <div className="flex justify-between mt-2 font-mono text-[10px] text-[#555f6d]"><span>{data[0]?.label ?? ""}</span><span>{data[data.length - 1]?.label ?? ""}</span></div>
    </div>
  );
}

function Donut({ data }: { data: { platform: string; count: number }[] }) {
  const total = Math.max(1, data.reduce((s, d) => s + d.count, 0));
  const R = 40, C = 2 * Math.PI * R;
  let acc = 0;
  // eslint-disable-next-line react-hooks/immutability -- acc akumulator offset donut (lokal, saat render; aman)
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
