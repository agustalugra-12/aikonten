"use client";

import { useMemo, useState } from "react";
import { useFetchedData } from "@/lib/useFetchedData";
import { toast } from "sonner";

// Planner - port Stitch §21 (2026-09-11, PRD). View Daftar/Minggu/Bulan. Data NYATA dari
// GET /api/brands/[id]/content-plan (ide + project). "AI Sarankan Rencana" -> POST
// content-plan/suggest (engine existing). "Tambah Konten" -> pindah ke Buat Konten.
// Tanpa mock. Tema token mockok + Material Symbols.

type PlanRow = {
  id: string;
  kind: "idea" | "project";
  date: string; // YYYY-MM-DD
  contentType: string | null;
  pillar: string | null;
  topicOrHook: string;
  status: string;
  experimentTier: "proven" | "variation" | "experiment" | null;
};

type Suggestion = { pillar: string; topic: string; hookType: string; reasoning: string };

const DAY_ID = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const MONTH_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function statusDot(status: string): string {
  const s = status.toLowerCase();
  if (s === "failed") return "bg-[#ba1a1a]";
  if (s === "published" || s === "ready") return "bg-black";
  if (s.includes("belum")) return "bg-[#c6c6cd]";
  return "bg-[#555f6d]";
}

function ItemChip({ row }: { row: PlanRow }) {
  return (
    <div className="rounded-lg bg-[#f0f3ff] px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <span className={"w-1.5 h-1.5 rounded-full shrink-0 " + statusDot(row.status)} />
        <span className="text-[11px] text-[#555f6d] truncate">{row.contentType || (row.kind === "idea" ? "Ide" : "Konten")}</span>
      </div>
      <p className="text-[12px] text-[#151c27] line-clamp-2 mt-0.5">{row.topicOrHook || "(tanpa judul)"}</p>
    </div>
  );
}

export function Planner({ brandId, onGoBuat }: { brandId: string; onGoBuat: () => void }) {
  const [view, setView] = useState<"daftar" | "minggu" | "bulan">("daftar");
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [monthCursor, setMonthCursor] = useState(() => new Date());

  const { data: rows } = useFetchedData<PlanRow[]>(
    () => fetch(`/api/brands/${brandId}/content-plan?days=30`).then((r) => r.json()).then((d) => d.rows || []),
    [brandId]
  );

  const byDate = useMemo(() => {
    const m = new Map<string, PlanRow[]>();
    for (const r of rows || []) {
      if (!m.has(r.date)) m.set(r.date, []);
      m.get(r.date)!.push(r);
    }
    return m;
  }, [rows]);

  async function handleSuggest() {
    setSuggestLoading(true);
    try {
      const res = await fetch(`/api/brands/${brandId}/content-plan/suggest`, { method: "POST" });
      const data = await res.json();
      setSuggestions(data.suggestions || []);
    } catch {
      toast.error("Gagal menyusun saran rencana.");
    } finally {
      setSuggestLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-2xl font-bold tracking-tight text-[#151c27]">Planner</h1>
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-[#e7eefe] text-[#151c27]">
              <span className="w-1.5 h-1.5 rounded-full bg-black inline-block animate-pulse" /> Pipeline Live
            </span>
          </div>
          <p className="text-[13px] text-[#555f6d] mt-0.5">Rencana &amp; antrean konten 30 hari brand ini.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleSuggest} disabled={suggestLoading} className="px-3 py-2 rounded-lg bg-white ring-1 ring-[#e7eefe] hover:ring-[#c6c6cd] text-[13px] font-medium text-[#151c27] flex items-center gap-1.5 disabled:opacity-60">
            <span className={"material-symbols-outlined text-[16px] " + (suggestLoading ? "animate-spin" : "")}>{suggestLoading ? "progress_activity" : "auto_awesome"}</span>
            AI Sarankan Rencana
          </button>
          <button onClick={onGoBuat} className="px-3 py-2 rounded-lg bg-black text-white text-[13px] font-medium flex items-center gap-1.5 hover:bg-[#2a313d]">
            <span className="material-symbols-outlined text-[16px]">add</span> Tambah Konten
          </button>
        </div>
      </div>

      {/* View tabs */}
      <div className="flex items-center gap-1 p-1 rounded-lg bg-[#f0f3ff] w-fit">
        {(["bulan", "minggu", "daftar"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} className={"px-3 py-1 rounded-md text-[12px] font-medium capitalize transition-colors " + (view === v ? "bg-black text-white shadow-sm" : "text-[#555f6d] hover:text-[#151c27]")}>{v}</button>
        ))}
      </div>

      {/* Saran (kalau ada) */}
      {suggestions && suggestions.length > 0 && (
        <div className="rounded-xl bg-white ring-1 ring-[#e7eefe] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#555f6d] mb-2">Saran Rencana AI</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {suggestions.map((s, i) => (
              <div key={i} className="rounded-lg bg-[#f0f3ff] p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-white text-[#555f6d]">{s.pillar}</span>
                  <span className="text-[11px] text-[#555f6d]">{s.hookType}</span>
                </div>
                <p className="text-[13px] font-medium text-[#151c27]">{s.topic}</p>
                {s.reasoning && <p className="text-[11px] text-[#555f6d] mt-1 line-clamp-2">{s.reasoning}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {!rows ? (
        <p className="text-[13px] text-[#555f6d] py-10 text-center">Memuat...</p>
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-[#555f6d] py-10 text-center">Belum ada rencana/konten. Klik "AI Sarankan Rencana" atau "Tambah Konten".</p>
      ) : view === "daftar" ? (
        <DaftarView byDate={byDate} />
      ) : view === "minggu" ? (
        <MingguView byDate={byDate} />
      ) : (
        <BulanView byDate={byDate} cursor={monthCursor} onPrev={() => setMonthCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))} onNext={() => setMonthCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))} />
      )}
    </div>
  );
}

function DaftarView({ byDate }: { byDate: Map<string, PlanRow[]> }) {
  const dates = [...byDate.keys()].sort((a, b) => (a < b ? 1 : -1));
  return (
    <div className="space-y-4">
      {dates.map((date) => (
        <div key={date}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#555f6d] mb-2">
            {new Date(date).toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "long" })}
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {byDate.get(date)!.map((r) => <ItemChip key={r.id} row={r} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function MingguView({ byDate }: { byDate: Map<string, PlanRow[]> }) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - ((today.getDay() + 6) % 7)); // Senin
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  return (
    <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
      {days.map((d) => {
        const key = ymd(d);
        const items = byDate.get(key) || [];
        const isToday = key === ymd(today);
        return (
          <div key={key} className="rounded-xl bg-white ring-1 ring-[#e7eefe] p-2 min-h-[120px]">
            <div className={"text-[11px] font-medium mb-2 " + (isToday ? "text-black" : "text-[#555f6d]")}>
              {DAY_ID[d.getDay()]} {d.getDate()}
            </div>
            <div className="space-y-1.5">
              {items.map((r) => <ItemChip key={r.id} row={r} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BulanView({ byDate, cursor, onPrev, onNext }: { byDate: Map<string, PlanRow[]>; cursor: Date; onPrev: () => void; onNext: () => void }) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const startPad = (first.getDay() + 6) % 7; // Senin=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = ymd(new Date());
  const cells: (Date | null)[] = [
    ...Array.from({ length: startPad }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];
  return (
    <div className="rounded-xl bg-white ring-1 ring-[#e7eefe] p-3">
      <div className="flex items-center justify-between mb-3">
        <button onClick={onPrev} className="p-1 rounded hover:bg-[#f0f3ff] text-[#555f6d]"><span className="material-symbols-outlined text-[20px]">chevron_left</span></button>
        <span className="font-heading text-sm font-semibold text-[#151c27]">{MONTH_ID[month]} {year}</span>
        <button onClick={onNext} className="p-1 rounded hover:bg-[#f0f3ff] text-[#555f6d]"><span className="material-symbols-outlined text-[20px]">chevron_right</span></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase text-[#555f6d] mb-1">
        {["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"].map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="min-h-[64px]" />;
          const key = ymd(d);
          const items = byDate.get(key) || [];
          const isToday = key === today;
          return (
            <div key={i} className={"min-h-[64px] rounded-lg p-1 " + (isToday ? "bg-[#e7eefe]" : "bg-[#f0f3ff]/50")}>
              <div className={"text-[11px] mb-1 " + (isToday ? "font-semibold text-black" : "text-[#555f6d]")}>{d.getDate()}</div>
              <div className="space-y-0.5">
                {items.slice(0, 2).map((r) => (
                  <div key={r.id} className="flex items-center gap-1">
                    <span className={"w-1.5 h-1.5 rounded-full shrink-0 " + statusDot(r.status)} />
                    <span className="text-[10px] text-[#151c27] truncate">{r.topicOrHook || r.contentType || "Konten"}</span>
                  </div>
                ))}
                {items.length > 2 && <div className="text-[10px] text-[#555f6d]">+{items.length - 2} lagi</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
