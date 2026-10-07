"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

// Ganti footage (2026-10-05, Fase B - permintaan Agus). Owner pilih footage pengganti dari
// 3 sumber (Footage Bank / Pexels / Upload) -> POST /footage (tukar raw_footage) -> POST
// /process (re-render, ada biaya kredit). Dipakai dari BuatKonten Studio preview.
type Pick = { fileUrl: string; durationSeconds?: number | null; posterUrl?: string | null };
type BankItem = { id: string; mediaType: string; fileUrl: string; description: string; posterUrl?: string | null; durationSeconds?: number | null };

export function FootageSwapModal({
  brandId,
  projectId,
  onClose,
  onDone,
}: {
  brandId: string;
  projectId: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [tab, setTab] = useState<"bank" | "pexels" | "upload">("bank");
  const [bank, setBank] = useState<BankItem[] | null>(null);
  const [q, setQ] = useState("");
  const [pexels, setPexels] = useState<Pick[]>([]);
  const [searching, setSearching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<Pick[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/brands/${brandId}/footage-bank`)
      .then((r) => r.json())
      .then((rows) => setBank(Array.isArray(rows) ? rows : []))
      .catch(() => setBank([]));
  }, [brandId]);

  const isSel = (url: string) => selected.some((s) => s.fileUrl === url);
  function toggle(p: Pick) {
    setSelected((s) => (s.some((x) => x.fileUrl === p.fileUrl) ? s.filter((x) => x.fileUrl !== p.fileUrl) : [...s, p]));
  }

  async function searchPexels() {
    if (!q.trim()) return;
    setSearching(true);
    try {
      const d = await fetch(`/api/brands/${brandId}/stock-search?q=${encodeURIComponent(q)}`).then((r) => r.json());
      setPexels(d.results || []);
      if ((d.results || []).length === 0) toast.message("Tidak ada hasil stok.");
    } catch {
      toast.error("Pencarian stok gagal.");
    } finally {
      setSearching(false);
    }
  }

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const pre = await fetch(`/api/projects/${projectId}/upload-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, contentType: file.type }),
        }).then((r) => r.json());
        if (!pre.uploadUrl) throw new Error();
        const put = await fetch(pre.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
        if (!put.ok) throw new Error();
        setSelected((s) => [...s, { fileUrl: pre.publicUrl }]);
      }
      toast.success("File terunggah & dipilih.");
    } catch {
      toast.error("Upload gagal.");
    } finally {
      setUploading(false);
    }
  }

  async function swapAndRender() {
    if (selected.length === 0) return;
    if (!confirm(`Ganti footage dengan ${selected.length} item lalu RENDER ULANG? (memakai kredit generate)`)) return;
    setBusy(true);
    try {
      const r1 = await fetch(`/api/projects/${projectId}/footage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: selected.map((s) => ({ fileUrl: s.fileUrl, durationSeconds: s.durationSeconds ?? undefined })) }),
      });
      if (!r1.ok) throw new Error((await r1.json().catch(() => ({}))).error || "Gagal ganti footage.");
      const r2 = await fetch(`/api/projects/${projectId}/process`, { method: "POST" });
      const d2 = await r2.json().catch(() => ({}));
      if (!r2.ok) throw new Error(d2.error || "Render ulang gagal.");
      toast.success("Footage diganti & dirender ulang.");
      onDone?.();
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Gagal.");
    } finally {
      setBusy(false);
    }
  }

  const tabBtn = (k: typeof tab, label: string) => (
    <button onClick={() => setTab(k)} className={"px-3 py-1.5 rounded-md text-[12px] font-medium transition " + (tab === k ? "bg-black text-white" : "text-[#555f6d] hover:text-[#151c27]")}>{label}</button>
  );
  const thumb = (p: Pick, key: string) => (
    <button key={key} type="button" onClick={() => toggle(p)} className={"relative aspect-square rounded-lg overflow-hidden ring-2 " + (isSel(p.fileUrl) ? "ring-black" : "ring-transparent hover:ring-[#c6c6cd]")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={p.posterUrl || p.fileUrl} alt="" className="w-full h-full object-cover bg-[#f0f3ff]" />
      {isSel(p.fileUrl) && <span className="absolute top-1 right-1 material-symbols-outlined text-[18px] text-white bg-black rounded-full">check_circle</span>}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-heading text-lg font-bold text-[#151c27]">Ganti Footage</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-[#f0f3ff] text-[#555f6d]"><span className="material-symbols-outlined text-[20px]">close</span></button>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-[#f0f3ff] w-fit mb-3">
          {tabBtn("bank", "Footage Bank")}
          {tabBtn("pexels", "Pexels")}
          {tabBtn("upload", "Upload")}
        </div>

        <div className="flex-1 overflow-y-auto min-h-[200px]">
          {tab === "bank" && (
            !bank ? <p className="text-[13px] text-[#555f6d] py-8 text-center">Memuat...</p> :
            bank.length === 0 ? <p className="text-[13px] text-[#555f6d] py-8 text-center">Footage Bank kosong.</p> :
            <div className="grid grid-cols-4 gap-2">{bank.map((b) => thumb({ fileUrl: b.fileUrl, durationSeconds: b.durationSeconds, posterUrl: b.posterUrl || (b.mediaType === "image" ? b.fileUrl : null) }, b.id))}</div>
          )}
          {tab === "pexels" && (
            <div>
              <div className="flex gap-2 mb-3">
                <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && searchPexels()} placeholder="Cari stok video (mis. coffee shop)" className="flex-1 rounded-lg ring-1 ring-[#e7eefe] focus:ring-[#c6c6cd] outline-none px-3 py-2 text-[13px]" />
                <button onClick={searchPexels} disabled={searching} className="px-3 py-2 rounded-lg bg-black text-white text-[13px] font-medium disabled:opacity-60">{searching ? "..." : "Cari"}</button>
              </div>
              <div className="grid grid-cols-4 gap-2">{pexels.map((p, i) => thumb(p, `px${i}`))}</div>
            </div>
          )}
          {tab === "upload" && (
            <div className="py-6 text-center">
              <label className="inline-flex flex-col items-center gap-2 cursor-pointer rounded-xl ring-1 ring-dashed ring-[#c6c6cd] px-6 py-8 hover:bg-[#f0f3ff]">
                <span className="material-symbols-outlined text-[32px] text-[#555f6d]">{uploading ? "progress_activity" : "upload_file"}</span>
                <span className="text-[13px] text-[#151c27]">{uploading ? "Mengunggah..." : "Pilih video/foto dari perangkat"}</span>
                <input type="file" accept="video/*,image/*" multiple className="hidden" onChange={(e) => handleUpload(e.target.files)} disabled={uploading} />
              </label>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-3 mt-3 border-t border-[#e7eefe]">
          <span className="text-[12px] text-[#555f6d]">{selected.length} dipilih</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-2 rounded-lg bg-white ring-1 ring-[#e7eefe] hover:ring-[#c6c6cd] text-[13px] font-medium text-[#151c27]">Batal</button>
            <button onClick={swapAndRender} disabled={busy || selected.length === 0} className="px-4 py-2 rounded-lg bg-black text-white text-[13px] font-medium flex items-center gap-1.5 hover:bg-[#2a313d] disabled:opacity-60">
              <span className={"material-symbols-outlined text-[16px] " + (busy ? "animate-spin" : "")}>{busy ? "progress_activity" : "autorenew"}</span>
              {busy ? "Merender…" : "Ganti & Render Ulang"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
