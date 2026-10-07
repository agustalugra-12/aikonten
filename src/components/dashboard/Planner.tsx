"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { UploadModal } from "./UploadModal";

// Planner editable (2026-10-05, PRD Fase 1 - permintaan Agus "jadwal konten editable
// berbentuk tabel"). Sumber data = tabel content_plan (forward). Owner: pilih ukuran
// rencana (30/60/90/120/150 konten, tanggal ikut cadence harian brand) -> "Buat Kerangka"
// -> edit tiap sel inline (PATCH per baris). Fase 2 (AI isi 30-hari) & Fase 3 (Generate
// pakai teks owner) menyusul. Tema token mockok + Material Symbols.

type PlanRow = {
  id: string;
  date: string;
  slotIndex: number;
  contentType: "video" | "foto" | "carousel";
  pillar: string | null;
  hook: string | null;
  topic: string | null;
  scriptBrief: string | null;
  draftCaption: string | null;
  draftHashtags: string | null;
  status: string;
  projectId: string | null;
  autoMode: string;
};

const SIZES = [30, 60, 90, 120, 150];
const TYPES: PlanRow["contentType"][] = ["video", "foto", "carousel"];

function statusBadge(status: string): string {
  if (status === "gagal") return "bg-[#ffdad6] text-[#ba1a1a]";
  if (status === "publish") return "bg-black text-white";
  if (status === "terjadwal") return "bg-[#e7eefe] text-[#151c27]";
  if (status === "digenerate") return "bg-[#d7f5dd] text-[#0b6b2e]";
  return "bg-[#f0f3ff] text-[#555f6d]"; // direncanakan
}

const cell = "w-full bg-transparent text-[12px] text-[#151c27] placeholder:text-[#c6c6cd] rounded px-1.5 py-1 hover:bg-[#f0f3ff] focus:bg-white focus:ring-1 focus:ring-[#c6c6cd] outline-none";

export function Planner({ brandId, onGoBuat }: { brandId: string; onGoBuat: () => void }) {
  const [rows, setRows] = useState<PlanRow[] | null>(null);
  const [size, setSize] = useState(60);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [genId, setGenId] = useState<string | null>(null);
  const [actId, setActId] = useState<string | null>(null);
  const [schedAt, setSchedAt] = useState<Record<string, string>>({});
  const [uploadRow, setUploadRow] = useState<PlanRow | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await fetch(`/api/brands/${brandId}/content-plan`).then((r) => r.json());
      setRows(d.rows || []);
    } catch {
      toast.error("Gagal memuat rencana.");
      setRows([]);
    }
  }, [brandId]);
  useEffect(() => {
    load();
  }, [load]);

  async function buatKerangka() {
    if (rows && rows.some((r) => r.status !== "direncanakan")) {
      if (!confirm("Baris yang BELUM diproses akan diganti kerangka baru (yang sudah digenerate/terjadwal tetap aman). Lanjut?")) return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/brands/${brandId}/content-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ size }),
      });
      if (!res.ok) throw new Error();
      await load();
      toast.success(`Kerangka ${size} konten dibuat.`);
    } catch {
      toast.error("Gagal membuat kerangka.");
    } finally {
      setBusy(false);
    }
  }

  async function aiFill() {
    setAiBusy(true);
    try {
      const res = await fetch(`/api/brands/${brandId}/content-plan/ai-fill`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error();
      await load();
      toast.success(d.filled > 0 ? `${d.filled} baris diisi AI.` : "Tidak ada baris kosong untuk diisi.");
    } catch {
      toast.error("AI gagal mengisi rencana - coba lagi.");
    } finally {
      setAiBusy(false);
    }
  }

  async function genRow(id: string) {
    setGenId(id);
    try {
      const res = await fetch(`/api/brands/${brandId}/content-plan/${id}/generate`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Gagal generate.");
      await load();
      toast.success("Konten digenerate — cek di menu Konten / Studio.");
    } catch (e) {
      toast.error((e as Error).message || "Gagal generate.");
    } finally {
      setGenId(null);
    }
  }

  // Fase 4: jadwal/publish dari tabel. Reuse endpoint project existing + PATCH status baris.
  async function patchStatus(rowId: string, status: string) {
    await fetch(`/api/brands/${brandId}/content-plan/${rowId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }

  async function scheduleRow(r: PlanRow) {
    if (!r.projectId) return;
    const val = schedAt[r.id] || `${r.date}T09:00`;
    const iso = new Date(val).toISOString();
    setActId(r.id);
    try {
      const res = await fetch(`/api/projects/${r.projectId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledFor: iso }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Gagal menjadwalkan.");
      await patchStatus(r.id, "terjadwal");
      await load();
      toast.success("Dijadwalkan.");
    } catch (e) {
      toast.error((e as Error).message || "Gagal menjadwalkan.");
    } finally {
      setActId(null);
    }
  }

  // Publish lewat modal pilih-kanal (2026-10-05). Modal yg POST /publish; di sini cukup
  // buka modal, lalu onDone tandai baris "publish".
  function publishRow(r: PlanRow) {
    if (!r.projectId) return;
    setUploadRow(r);
  }

  async function cancelSchedule(r: PlanRow) {
    if (!r.projectId) return;
    setActId(r.id);
    try {
      await fetch(`/api/projects/${r.projectId}/schedule`, { method: "DELETE" });
      await patchStatus(r.id, "digenerate");
      await load();
      toast.success("Jadwal dibatalkan.");
    } catch {
      toast.error("Gagal membatalkan jadwal.");
    } finally {
      setActId(null);
    }
  }

  async function setMode(rowId: string, mode: string) {
    setLocal(rowId, "autoMode", mode);
    await fetch(`/api/brands/${brandId}/content-plan/${rowId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoMode: mode }) });
  }
  async function bulkMode(mode: string) {
    if (!confirm(mode === "auto" ? "Set SEMUA baris belum-diproses jadi AUTO? Artinya DISETUJUI - cron akan generate di tanggalnya lalu auto-publish." : "Set semua baris belum-diproses jadi MANUAL?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/brands/${brandId}/content-plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bulkAutoMode: mode }) });
      if (!res.ok) throw new Error();
      await load();
      toast.success(mode === "auto" ? "Semua baris diset Auto (ikut cron)." : "Semua baris diset Manual.");
    } catch {
      toast.error("Gagal set mode.");
    } finally {
      setBusy(false);
    }
  }

  async function addRow() {
    setBusy(true);
    try {
      const res = await fetch(`/api/brands/${brandId}/content-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error();
      await load();
    } catch {
      toast.error("Gagal menambah baris.");
    } finally {
      setBusy(false);
    }
  }

  function setLocal(id: string, field: keyof PlanRow, value: string | number) {
    setRows((rs) => (rs ? rs.map((r) => (r.id === id ? { ...r, [field]: value } : r)) : rs));
  }

  async function commit(id: string, field: keyof PlanRow, value: string | number) {
    try {
      await fetch(`/api/brands/${brandId}/content-plan/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
    } catch {
      toast.error("Gagal menyimpan perubahan.");
    }
  }

  async function delRow(id: string) {
    setRows((rs) => (rs ? rs.filter((r) => r.id !== id) : rs));
    await fetch(`/api/brands/${brandId}/content-plan/${id}`, { method: "DELETE" });
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-2xl font-bold tracking-tight text-[#151c27]">Planner</h1>
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-[#e7eefe] text-[#151c27]">
              <span className="w-1.5 h-1.5 rounded-full bg-black inline-block animate-pulse" /> Jadwal Editable
            </span>
          </div>
          <p className="text-[13px] text-[#555f6d] mt-0.5">Rencana konten brand ini — tabel editable. Isi/ubah tiap sel, tersimpan otomatis.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <span className="text-[12px] text-[#555f6d] mr-1">Jumlah konten:</span>
            {SIZES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setSize(n)}
                className={"rounded-lg px-2.5 py-1.5 text-[12px] font-semibold ring-1 transition " + (size === n ? "bg-black text-white ring-black" : "bg-white text-[#151c27] ring-[#e7eefe] hover:ring-[#c6c6cd]")}
              >
                {n}
              </button>
            ))}
          </div>
          <button onClick={buatKerangka} disabled={busy} className="px-3 py-2 rounded-lg bg-black text-white text-[13px] font-medium flex items-center gap-1.5 hover:bg-[#2a313d] disabled:opacity-60">
            <span className={"material-symbols-outlined text-[16px] " + (busy ? "animate-spin" : "")}>{busy ? "progress_activity" : "event_note"}</span>
            Buat Kerangka Rencana
          </button>
          <button onClick={aiFill} disabled={aiBusy || !rows || rows.length === 0} title="Isi otomatis topik/hook/caption baris yang masih kosong" className="px-3 py-2 rounded-lg bg-white ring-1 ring-[#e7eefe] hover:ring-[#c6c6cd] text-[13px] font-medium text-[#151c27] flex items-center gap-1.5 disabled:opacity-60">
            <span className={"material-symbols-outlined text-[16px] " + (aiBusy ? "animate-spin" : "")}>{aiBusy ? "progress_activity" : "auto_awesome"}</span>
            AI Isi Rencana
          </button>
          <button onClick={addRow} disabled={busy} className="px-3 py-2 rounded-lg bg-white ring-1 ring-[#e7eefe] hover:ring-[#c6c6cd] text-[13px] font-medium text-[#151c27] flex items-center gap-1.5 disabled:opacity-60">
            <span className="material-symbols-outlined text-[16px]">add</span> Tambah Baris
          </button>
          <button onClick={onGoBuat} className="px-3 py-2 rounded-lg bg-white ring-1 ring-[#e7eefe] hover:ring-[#c6c6cd] text-[13px] font-medium text-[#151c27] flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]">bolt</span> Buat Konten
          </button>
          <span className="text-[12px] text-[#555f6d] ml-1">Semua:</span>
          <button onClick={() => bulkMode("auto")} disabled={busy || !rows || rows.length === 0} className="px-2.5 py-2 rounded-lg bg-white ring-1 ring-[#e7eefe] hover:ring-[#c6c6cd] text-[12px] font-semibold text-[#0b6b2e] disabled:opacity-60">Auto</button>
          <button onClick={() => bulkMode("manual")} disabled={busy || !rows || rows.length === 0} className="px-2.5 py-2 rounded-lg bg-white ring-1 ring-[#e7eefe] hover:ring-[#c6c6cd] text-[12px] font-semibold text-[#555f6d] disabled:opacity-60">Manual</button>
        </div>
      </div>

      {!rows ? (
        <p className="text-[13px] text-[#555f6d] py-10 text-center">Memuat...</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl bg-white ring-1 ring-[#e7eefe] p-10 text-center">
          <p className="text-[13px] text-[#555f6d]">Belum ada rencana. Pilih jumlah konten lalu klik <b>Buat Kerangka Rencana</b> — tanggal otomatis mengikuti jadwal harian brand.</p>
        </div>
      ) : (
        <div className="rounded-xl bg-white ring-1 ring-[#e7eefe] overflow-x-auto">
          <table className="w-full min-w-[1140px] border-collapse">
            <thead>
              <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-[#555f6d] border-b border-[#e7eefe]">
                <th className="px-3 py-2.5 w-[120px]">Tanggal</th>
                <th className="px-3 py-2.5 w-[110px]">Tipe</th>
                <th className="px-3 py-2.5 w-[120px]">Pillar</th>
                <th className="px-3 py-2.5 w-[200px]">Hook / Topik</th>
                <th className="px-3 py-2.5 w-[220px]">Skrip</th>
                <th className="px-3 py-2.5 w-[260px]">Caption</th>
                <th className="px-3 py-2.5 w-[160px]">Hashtag</th>
                <th className="px-3 py-2.5 w-[96px]">Status</th>
                <th className="px-3 py-2.5 w-[84px]">Mode</th>
                <th className="px-3 py-2.5 w-[170px]">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const locked = r.status !== "direncanakan";
                return (
                  <tr key={r.id} className="border-b border-[#f0f3ff] align-top">
                    <td className="px-2 py-1.5">
                      <input type="date" value={r.date} disabled={locked} onChange={(e) => setLocal(r.id, "date", e.target.value)} onBlur={(e) => commit(r.id, "date", e.target.value)} className={cell + " tabular-nums"} />
                    </td>
                    <td className="px-2 py-1.5">
                      <select value={r.contentType} disabled={locked} onChange={(e) => { setLocal(r.id, "contentType", e.target.value); commit(r.id, "contentType", e.target.value); }} className={cell + " capitalize"}>
                        {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={r.pillar || ""} placeholder="—" disabled={locked} onChange={(e) => setLocal(r.id, "pillar", e.target.value)} onBlur={(e) => commit(r.id, "pillar", e.target.value)} className={cell} />
                    </td>
                    <td className="px-2 py-1.5">
                      <textarea rows={2} value={r.hook || ""} placeholder="hook / topik konten" disabled={locked} onChange={(e) => setLocal(r.id, "hook", e.target.value)} onBlur={(e) => commit(r.id, "hook", e.target.value)} className={cell + " resize-y"} />
                    </td>
                    <td className="px-2 py-1.5">
                      <textarea rows={2} value={r.scriptBrief || ""} placeholder="skrip / brief (dipakai sbg dasar generate; kalau kosong pakai hook)" disabled={locked} onChange={(e) => setLocal(r.id, "scriptBrief", e.target.value)} onBlur={(e) => commit(r.id, "scriptBrief", e.target.value)} className={cell + " resize-y"} />
                    </td>
                    <td className="px-2 py-1.5">
                      <textarea rows={2} value={r.draftCaption || ""} placeholder="draft caption" disabled={locked} onChange={(e) => setLocal(r.id, "draftCaption", e.target.value)} onBlur={(e) => commit(r.id, "draftCaption", e.target.value)} className={cell + " resize-y"} />
                    </td>
                    <td className="px-2 py-1.5">
                      <textarea rows={2} value={r.draftHashtags || ""} placeholder="#tag1 #tag2" disabled={locked} onChange={(e) => setLocal(r.id, "draftHashtags", e.target.value)} onBlur={(e) => commit(r.id, "draftHashtags", e.target.value)} className={cell + " resize-y"} />
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={"inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded capitalize " + statusBadge(r.status)}>{r.status}</span>
                    </td>
                    <td className="px-2 py-1.5">
                      {r.status === "direncanakan" ? (
                        <button type="button" onClick={() => setMode(r.id, r.autoMode === "auto" ? "manual" : "auto")} title="Klik untuk ganti Auto/Manual" className={"text-[10px] font-semibold px-1.5 py-0.5 rounded " + (r.autoMode === "auto" ? "bg-[#d7f5dd] text-[#0b6b2e]" : "bg-[#f0f3ff] text-[#555f6d]")}>
                          {r.autoMode === "auto" ? "Auto" : "Manual"}
                        </button>
                      ) : (
                        <span className="text-[10px] text-[#555f6d]">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {(() => {
                        const busyRow = genId === r.id || actId === r.id;
                        const iconBtn = (onClick: () => void, icon: string, title: string, cls: string, spin = false) => (
                          <button onClick={onClick} disabled={busyRow} title={title} className={"p-1 rounded disabled:opacity-60 " + cls}>
                            <span className={"material-symbols-outlined text-[18px] " + (spin ? "animate-spin" : "")}>{icon}</span>
                          </button>
                        );
                        const del = iconBtn(() => delRow(r.id), "delete", "Hapus baris", "text-[#555f6d] hover:bg-[#ffdad6] hover:text-[#ba1a1a]");
                        if (r.status === "direncanakan")
                          return (
                            <div className="flex items-center gap-0.5">
                              {iconBtn(() => genRow(r.id), genId === r.id ? "progress_activity" : "play_circle", "Generate konten dari baris ini", "text-[#555f6d] hover:bg-[#d7f5dd] hover:text-[#0b6b2e]", genId === r.id)}
                              {del}
                            </div>
                          );
                        if (r.status === "digenerate")
                          return (
                            <div className="flex flex-col gap-1">
                              <input
                                type="datetime-local"
                                defaultValue={`${r.date}T09:00`}
                                onChange={(e) => setSchedAt((s) => ({ ...s, [r.id]: e.target.value }))}
                                className="text-[11px] ring-1 ring-[#e7eefe] rounded px-1 py-0.5 text-[#151c27] outline-none focus:ring-[#c6c6cd]"
                              />
                              <div className="flex items-center gap-0.5">
                                {iconBtn(() => scheduleRow(r), actId === r.id ? "progress_activity" : "event_upcoming", "Jadwalkan", "text-[#555f6d] hover:bg-[#e7eefe] hover:text-[#151c27]", actId === r.id)}
                                {iconBtn(() => publishRow(r), "send", "Publikasikan sekarang", "text-[#555f6d] hover:bg-[#d7f5dd] hover:text-[#0b6b2e]")}
                                {del}
                              </div>
                            </div>
                          );
                        if (r.status === "terjadwal")
                          return (
                            <div className="flex items-center gap-0.5">
                              {iconBtn(() => cancelSchedule(r), actId === r.id ? "progress_activity" : "event_busy", "Batalkan jadwal", "text-[#555f6d] hover:bg-[#ffdad6] hover:text-[#ba1a1a]", actId === r.id)}
                              {iconBtn(() => publishRow(r), "send", "Publikasikan sekarang", "text-[#555f6d] hover:bg-[#d7f5dd] hover:text-[#0b6b2e]")}
                              {del}
                            </div>
                          );
                        return <div className="flex items-center gap-0.5">{del}</div>;
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-[#555f6d]">
        {rows && rows.length > 0 ? `${rows.length} baris rencana. ` : ""}
        Alur: Buat Kerangka → AI Isi Rencana (atau isi manual) → edit sel → <b>Generate</b> (play) → <b>Jadwalkan</b> / <b>Publikasikan</b> per baris.
      </p>

      {uploadRow && uploadRow.projectId && (
        <UploadModal
          brandId={brandId}
          projectId={uploadRow.projectId}
          onClose={() => setUploadRow(null)}
          onDone={async () => {
            await patchStatus(uploadRow.id, "publish");
            await load();
          }}
        />
      )}
    </div>
  );
}
