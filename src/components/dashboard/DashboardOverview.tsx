"use client";


import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProjectList } from "@/components/dashboard/ProjectList";
import { Send, FileClock, Wallet, Flame } from "lucide-react";
import { useFetchedData } from "@/lib/useFetchedData";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer, Tooltip, Pie, PieChart, Cell } from "recharts";
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

// Palet grayscale utk donut chart (2026-08-13) - TIDAK ada warna baru, cuma variasi
// TERANG-GELAP dari token foreground yg sudah ada (beda platform dibedakan lewat
// kontras, bukan hue) - konsisten dgn constraint "hitam putih spt sekarang saja".
const DONUT_SHADES = ["#1a1a1a", "#4d4d4d", "#808080", "#b3b3b3", "#d9d9d9"];

const DAY_LABEL_ID = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

// Overview dashboard (2026-08-13, permintaan Agus - konsep referensi gaya app musik,
// struktur [greeting+stat card+chart+list] diikuti, SEMUA angka data nyata dari
// /api/brands/[id]/dashboard-stats (lihat catatan lengkap di situ soal mapping),
// warna tetap grayscale.
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
    () =>
      brand?.id
        ? fetch(`/api/brands/${brand.id}/dashboard-stats`).then((res) => res.json())
        : Promise.resolve(null),
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
      {/* Banner sapaan - versi greeting "Good Morning, Mia!" dari referensi, tanpa
          maskot ilustrasi (di-drop sesuai instruksi hitam-putih). */}
      <div className="rounded-2xl border bg-foreground text-background p-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-lg font-semibold">{sapaan}! 👋</p>
          <p className="text-sm text-background/70 mt-0.5">
            {brand ? `Ringkasan aktivitas konten ${brand.name} minggu ini.` : "Pilih brand utk lihat ringkasan."}
          </p>
        </div>
      </div>

      {/* 4 kartu statistik - pola sama dgn "Songs Played/Favorites/Hours Listened/
          Streak" di referensi, tapi semua angka nyata. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={Send}
          label="Dipublikasikan"
          value={stats ? String(stats.publishedThisWeek) : "…"}
          sub={stats ? `${stats.publishedThisWeekDeltaPercent >= 0 ? "+" : ""}${stats.publishedThisWeekDeltaPercent}% minggu ini` : ""}
        />
        <StatCard icon={FileClock} label="Draft Menunggu" value={stats ? String(stats.draftCount) : "…"} sub="siap direview" />
        <StatCard icon={Wallet} label="Biaya AI Bulan Ini" value={stats ? formatUsd(stats.costThisMonth) : "…"} sub="OpenAI + fal.ai" />
        <StatCard icon={Flame} label="Hari Beruntun" value={stats ? String(stats.streak) : "…"} sub="publish tiap hari" />
      </div>

      {/* 2 chart berdampingan - bar chart aktivitas 7 hari + donut distribusi platform. */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Aktivitas Publish (7 Hari)</CardTitle>
          </CardHeader>
          <CardContent className="h-56">
            {stats && chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={24} />
                  <Tooltip
                    contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: "var(--popover-foreground)" }}
                  />
                  <Bar dataKey="count" fill="var(--foreground)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground h-full flex items-center justify-center">Memuat...</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Distribusi Platform (30 Hari)</CardTitle>
          </CardHeader>
          <CardContent className="h-56">
            {stats && stats.platformDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={stats.platformDistribution} dataKey="count" nameKey="platform" innerRadius={45} outerRadius={75} paddingAngle={2}>
                    {stats.platformDistribution.map((entry, i) => (
                      <Cell key={entry.platform} fill={DONUT_SHADES[i % DONUT_SHADES.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: "var(--popover-foreground)" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground h-full flex items-center justify-center">
                {stats ? "Belum ada publish 30 hari terakhir." : "Memuat..."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* "Recently Played" -> Konten Terbaru, reuse ProjectList yg sudah ada. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Konten Terbaru</CardTitle>
        </CardHeader>
        <CardContent>
          <ProjectList projects={projects.slice(0, 5)} brand={brand} accounts={accounts} onRetry={onRetryProject} />
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub }: { icon: typeof Send; label: string; value: string; sub: string }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
        {sub && <p className="text-xs text-muted-foreground/80">{sub}</p>}
      </CardContent>
    </Card>
  );
}
