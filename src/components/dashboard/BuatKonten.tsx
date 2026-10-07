"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { NewProjectDialog } from "@/components/dashboard/NewProjectDialog";
import type { Brand, ProjectDetail } from "@/types";
import { UploadModal } from "@/components/dashboard/UploadModal";
import { createZip } from "@/lib/zip";
import { FootageSwapModal } from "@/components/dashboard/FootageSwapModal";

// Buat Konten "Studio" 2-kolom - port Stitch §6-19 (2026-09-11, PRD Stitch UI rebuild).
// UI mengikuti Stitch; GENERATE memanggil engine NYATA existing:
//   prompt -> POST /api/brands/[id]/auto-content { script, type }  (runAutoContent)
//   preview -> GET /api/projects/[id]
// Tone/audiens ditulis-balik ke config brand existing (PATCH /api/brands/[id]) -
// TIDAK bikin sistem tone kedua (PRD §10). TANPA mock/setTimeout (PRD §12/§27).
// Score judul disembunyikan (tak ada engine-nya, PRD §14). Target kanal = tahap
// publish/jadwal (keputusan Agus), tidak di layar ini. Caption Only = jalur baru,
// increment berikut (ditandai "segera").

type Fmt = "video" | "carousel" | "foto" | "caption";
const FORMATS: { key: Fmt; label: string; icon: string; desc: string; ready: boolean }[] = [
  { key: "video", label: "Reels / Video", icon: "smart_display", desc: "Video pendek/panjang + footage otomatis", ready: true },
  { key: "carousel", label: "Carousel", icon: "auto_stories", desc: "Beberapa slide edukatif", ready: true },
  { key: "foto", label: "Poster Feed", icon: "image", desc: "Poster / infografis feed", ready: true },
  { key: "caption", label: "Caption Only", icon: "notes", desc: "Caption + hashtag saja", ready: true },
];

const TONES = [
  "Edukatif & Berbobot",
  "Professional & Data-Driven",
  "Kasual & Relatable",
  "Persuasif / Hard Selling",
  "Storytelling Personal",
];

const MAX_PROMPT = 600;

function proxiedUrl(u: string): string {
  return `/api/media-proxy?url=${encodeURIComponent(u)}`;
}

export function BuatKonten({
  brandId,
  brand,
  onRefresh,
}: {
  brandId: string;
  brand: Brand | null;
  onRefresh: () => void;
}) {
  const [fmt, setFmt] = useState<Fmt>("video");
  const [prompt, setPrompt] = useState("");
  const [tone, setTone] = useState<string>(brand?.toneOfVoice || "");
  const [audience, setAudience] = useState<string>(brand?.targetAudience || "");
  const [advOpen, setAdvOpen] = useState(false);
  const [ideas, setIdeas] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<ProjectDetail | null>(null);
  const [captionResult, setCaptionResult] = useState<{ caption: string; hashtags: string[] } | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [editing, setEditing] = useState(false);
  const [edCaption, setEdCaption] = useState("");
  const [edHashtags, setEdHashtags] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [showFootage, setShowFootage] = useState(false);
  const [duration, setDuration] = useState<number>(60);
  const [carouselCount, setCarouselCount] = useState<number>(3);
  const [orientation, setOrientation] = useState<string>("portrait");
  const [footageSrc, setFootageSrc] = useState<string>(brand?.footageSource || "internal");
  const [carouselVisual, setCarouselVisual] = useState<string>(brand?.allowAiGeneratedPhotos ? "ai" : "footage");
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  async function saveCaptionDraft() {
    if (!captionResult) return;
    setSavingDraft(true);
    try {
      const res = await fetch(`/api/brands/${brandId}/caption-only`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: prompt.trim() || captionResult.caption.slice(0, 80),
          caption: captionResult.caption,
          hashtags: captionResult.hashtags,
          persist: true,
        }),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok || !b.projectId) {
        toast.error(b.error || "Gagal simpan draft");
        return;
      }
      toast.success("Caption disimpan sbg draft - buka Konten utk jadwal/publish.");
      onRefresh();
    } catch {
      toast.error("Gagal simpan draft");
    } finally {
      setSavingDraft(false);
    }
  }

  // Inspiration chips dari ide harian nyata (bukan hardcode).
  useEffect(() => {
    let alive = true;
    fetch(`/api/brands/${brandId}/daily-ideas`)
      .then((r) => r.json())
      .then((rows: { idea: string }[]) => {
        if (alive && Array.isArray(rows)) setIdeas(rows.slice(0, 4).map((r) => r.idea).filter(Boolean));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [brandId]);

  async function downloadAsset() {
    const ts = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    const dl = (blob: Blob, name: string) => {
      const url = URL.createObjectURL(blob);
      const el = document.createElement("a");
      el.href = url; el.download = name; el.click();
      URL.revokeObjectURL(url);
    };
    const video = result?.assets?.find((a) => a.type === "final_video");
    const imgs = result?.assets?.filter((a) => a.type === "final_image") || [];
    try {
      if (video) {
        dl(await (await fetch(proxiedUrl(video.fileUrl))).blob(), `kontenpilot_${fmt}_${ts}.mp4`);
      } else if (imgs.length > 1) {
        // Carousel multi-slide -> ZIP semua slide (2026-10-05, permintaan Agus).
        const files = await Promise.all(
          imgs.map(async (a, i) => ({ name: `slide_${i + 1}.png`, data: new Uint8Array(await (await fetch(proxiedUrl(a.fileUrl))).arrayBuffer()) }))
        );
        dl(createZip(files), `kontenpilot_carousel_${ts}.zip`);
      } else if (imgs.length === 1) {
        dl(await (await fetch(proxiedUrl(imgs[0].fileUrl))).blob(), `kontenpilot_${fmt}_${ts}.png`);
      } else {
        toast.error("Belum ada file untuk diunduh");
      }
    } catch { toast.error("Gagal mengunduh file"); }
  }

  // Upload modal pilih-kanal (2026-10-05) - buka modal; modal yg POST /publish & edit caption.
  function uploadToChannels() {
    if (!result) return;
    setShowUpload(true);
  }

  // Edit teks preview (Fase A 2026-10-05) - ubah caption/hashtag tanpa re-generate.
  function startEdit() {
    setEdCaption(result?.generatedCaption || "");
    let hz = "";
    try { hz = (JSON.parse(result?.generatedHashtags || "[]") as string[]).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" "); } catch {}
    setEdHashtags(hz);
    setEditing(true);
  }
  async function saveEdit() {
    if (!result) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/projects/${result.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generatedCaption: edCaption, generatedHashtags: edHashtags }),
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setResult((r) => (r ? { ...r, generatedCaption: d.generatedCaption, generatedHashtags: d.generatedHashtags } : r));
      setEditing(false);
      toast.success("Perubahan disimpan.");
    } catch {
      toast.error("Gagal menyimpan.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleGenerate() {
    const fmtDef = FORMATS.find((f) => f.key === fmt)!;
    if (!fmtDef.ready) {
      toast.error("Format ini sedang dibangun, pilih Video/Carousel/Poster dulu.");
      return;
    }
    if (prompt.trim().length < 3) {
      toast.error("Tuliskan ide/topik kontennya dulu.");
      return;
    }
    setGenerating(true);
    setResult(null);
    setCaptionResult(null);
    try {
      // 1) Tulis-balik tone/audiens ke config brand existing (PRD §10) bila diisi/diubah.
      const patch: Record<string, string> = {};
      if (tone && tone !== (brand?.toneOfVoice || "")) patch.toneOfVoice = tone;
      if (audience && audience !== (brand?.targetAudience || "")) patch.targetAudience = audience;
      if (fmt === "video") patch.videoDurationTarget = String(duration);
      if (fmt === "carousel") patch.carouselPhotosPerPost = String(carouselCount);
      if (fmt !== "caption") { patch.videoOrientation = orientation; patch.footageSource = footageSrc; }
      if (Object.keys(patch).length > 0) {
        await fetch(`/api/brands/${brandId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
      }

      // Caption Only (jalur baru) - endpoint caption-only (reuse LLM caption existing).
      if (fmt === "caption") {
        const capRes = await fetch(`/api/brands/${brandId}/caption-only`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ script: prompt.trim() }),
        });
        const capBody = await capRes.json().catch(() => ({}));
        if (!capRes.ok) {
          toast.error(capBody.error || "Gagal membuat caption.");
          return;
        }
        setCaptionResult({ caption: capBody.caption || "", hashtags: capBody.hashtags || [] });
        toast.success("Caption dibuat - salin dari Studio Preview.");
        return;
      }

      // 2) Generate lewat engine NYATA (runAutoContent) - prompt jadi `script`.
      const res = await fetch(`/api/brands/${brandId}/auto-content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: prompt.trim(), type: fmt, carouselVisual: fmt === "carousel" ? carouselVisual : undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        toast.error(body.error || "Brand sedang diproses, tunggu sebentar lalu coba lagi.");
        return;
      }
      if (!res.ok || !body.projectId) {
        toast.error(body.error || "Gagal generate konten.");
        return;
      }

      // 3) Ambil hasil nyata utk Studio Preview.
      const detail: ProjectDetail = await fetch(`/api/projects/${body.projectId}`).then((r) => r.json());
      setResult(detail);
      onRefresh();
      toast.success("Konten dibuat - cek Studio Preview & halaman Konten.");
    } catch {
      toast.error("Gagal generate konten, coba lagi nanti.");
    } finally {
      setGenerating(false);
    }
  }

  function onPromptKey(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleGenerate();
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
      {/* ===== KIRI: input ===== */}
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-heading text-2xl font-bold tracking-tight text-[#151c27]">Buat Konten</h1>
              <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-black text-white">v2 Studio</span>
            </div>
            <p className="text-[13px] text-[#555f6d] mt-1">
              Ubah ide mentah menjadi storyboard, visual, dan caption siap rilis — pakai engine AI KontenPilot.
            </p>
          </div>
          {/* Jalur MANUAL (2026-09-12) - punya footage/skrip sendiri? Upload + tulis
              skrip via NewProjectDialog existing (butuh upload file). Dikembalikan ke
              halaman Buat Konten krn sempat hilang di Studio (cuma jalur prompt). */}
          <div className="flex flex-col items-end gap-1">
            <NewProjectDialog brandId={brandId} carouselPhotosPerPost={brand?.carouselPhotosPerPost ?? 5} onCreated={onRefresh} />
            <span className="text-[11px] text-[#555f6d]">Manual: upload footage/foto + skrip sendiri</span>
          </div>
        </div>

        {/* Format selector */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#555f6d] mb-2">Format Konten</p>
          <div className="grid grid-cols-2 gap-2">
            {FORMATS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => f.ready ? setFmt(f.key) : toast.message("Caption Only segera hadir")}
                className={
                  "flex items-start gap-2.5 p-3 rounded-xl text-left transition-all ring-1 " +
                  (fmt === f.key && f.ready
                    ? "bg-black text-white ring-black"
                    : "bg-white ring-[#e7eefe] hover:ring-[#c6c6cd] " + (f.ready ? "" : "opacity-60"))
                }
              >
                <span className="material-symbols-outlined text-[20px] mt-0.5">{f.icon}</span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">{f.label}</span>
                  <span className={"block text-[11px] mt-0.5 " + (fmt === f.key && f.ready ? "text-white/70" : "text-[#555f6d]")}>{f.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Prompt console */}
        <div className="rounded-xl bg-white ring-1 ring-[#e7eefe] p-3">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-[#555f6d]">Deskripsikan ide / topik konten</label>
            <button type="button" onClick={() => setPrompt("")} className="text-[11px] text-[#555f6d] hover:text-[#151c27]">Bersihkan</button>
          </div>
          <textarea
            ref={taRef}
            value={prompt}
            maxLength={MAX_PROMPT}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onPromptKey}
            rows={4}
            placeholder="mis. 3 kesalahan UMKM saat mulai jualan online dan cara menghindarinya"
            className="w-full resize-none bg-transparent text-[14px] text-[#151c27] placeholder:text-[#a0a0aa] focus:outline-none"
          />
          <div className="flex items-center justify-between mt-1">
            <div className="flex flex-wrap gap-1">
              {ideas.map((idea, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPrompt(idea.slice(0, MAX_PROMPT))}
                  title={idea}
                  className="px-2 py-0.5 rounded-full bg-[#f0f3ff] text-[#555f6d] text-[11px] hover:bg-[#e7eefe] max-w-[180px] truncate"
                >
                  {idea}
                </button>
              ))}
            </div>
            <span className="font-mono text-[11px] text-[#555f6d] tabular-nums shrink-0">{prompt.length} / {MAX_PROMPT}</span>
          </div>
        </div>

        {/* Tone */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#555f6d] mb-2">Tone of Voice</p>
          <div className="flex flex-wrap gap-1.5">
            {TONES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTone(tone === t ? "" : t)}
                className={
                  "px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors ring-1 " +
                  (tone === t ? "bg-black text-white ring-black" : "bg-white text-[#151c27] ring-[#e7eefe] hover:ring-[#c6c6cd]")
                }
              >
                {t}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-[#555f6d] mt-1.5">Tersimpan ke tone brand (dipakai engine generate).</p>
        </div>

        {/* Advanced */}
        <div className="rounded-xl bg-white ring-1 ring-[#e7eefe]">
          <button
            type="button"
            onClick={() => setAdvOpen((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-[13px] font-medium text-[#151c27]"
          >
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-[#555f6d]">tune</span>
              Pengaturan Lanjutan
            </span>
            <span className="material-symbols-outlined text-[18px] text-[#555f6d]">{advOpen ? "expand_less" : "expand_more"}</span>
          </button>
          {advOpen && (
            <div className="px-3 pb-3 space-y-2">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#555f6d]">Target Audiens</label>
              <input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="mis. pemilik UMKM 25-40 di kota besar"
                className="w-full h-9 px-3 rounded-lg bg-[#f0f3ff] text-[14px] text-[#151c27] placeholder:text-[#a0a0aa] focus:outline-none"
              />
              <p className="text-[11px] text-[#555f6d]">Tersimpan ke target audiens brand (dipakai engine). Durasi/CTA ikut Pengaturan Brand.</p>
            </div>
          )}
        </div>

        {/* Durasi (Reels) & Jumlah gambar (Carousel) - pilihan per-generate (Fase 2) */}
        {fmt === "video" && (
          <div className="mb-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#555f6d] mb-1.5">Durasi</p>
            <div className="flex gap-2">
              {(orientation === "landscape" ? [30, 60, 90, 180, 300, 480] : [30, 60]).map((d) => (
                <button key={d} type="button" onClick={() => setDuration(d)}
                  className={"rounded-lg px-3 py-1.5 text-[12px] font-semibold ring-1 transition " + (duration === d ? "bg-black text-white ring-black" : "bg-white text-[#151c27] ring-[#e7eefe] hover:ring-[#c6c6cd]")}>
                  {d < 120 ? `${d} detik` : `${d / 60} menit`}
                </button>
              ))}
            </div>
          </div>
        )}
        {fmt === "carousel" && (
          <div className="mb-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#555f6d] mb-1.5">Jumlah gambar</p>
            <div className="flex gap-2">
              {[2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setCarouselCount(n)}
                  className={"rounded-lg px-3 py-1.5 text-[12px] font-semibold ring-1 transition " + (carouselCount === n ? "bg-black text-white ring-black" : "bg-white text-[#151c27] ring-[#e7eefe] hover:ring-[#c6c6cd]")}>
                  {n} gambar
                </button>
              ))}
            </div>
          </div>
        )}
        {fmt !== "caption" && (
          <div className="mb-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#555f6d] mb-1.5">Orientasi</p>
            <div className="flex gap-2">
              {([["portrait", "Portrait"], ["landscape", "Landscape"]] as [string, string][]).map(([v, l]) => (
                <button key={v} type="button" onClick={() => { setOrientation(v); if (v === "portrait" && duration > 60) setDuration(60); }}
                  className={"rounded-lg px-3 py-1.5 text-[12px] font-semibold ring-1 transition " + (orientation === v ? "bg-black text-white ring-black" : "bg-white text-[#151c27] ring-[#e7eefe] hover:ring-[#c6c6cd]")}>{l}</button>
              ))}
            </div>
          </div>
        )}
        {fmt === "carousel" && (
          <div className="mb-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#555f6d] mb-1.5">Gambar carousel</p>
            <div className="flex gap-2">
              {([["footage", "Footage asli"], ["ai", "Buat AI (poster)"]] as [string, string][]).map(([v, l]) => (
                <button key={v} type="button" onClick={() => setCarouselVisual(v)}
                  className={"rounded-lg px-3 py-1.5 text-[12px] font-semibold ring-1 transition " + (carouselVisual === v ? "bg-black text-white ring-black" : "bg-white text-[#151c27] ring-[#e7eefe] hover:ring-[#c6c6cd]")}>{l}</button>
              ))}
            </div>
          </div>
        )}
        {fmt !== "caption" && (
          <div className="mb-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#555f6d] mb-1.5">Sumber footage</p>
            <div className="flex gap-2 flex-wrap">
              {([["internal", "Dari Bank"], ["pexels", "Pexels"], ["mixed", "Gabungan"]] as [string, string][]).map(([v, l]) => (
                <button key={v} type="button" onClick={() => setFootageSrc(v)}
                  className={"rounded-lg px-3 py-1.5 text-[12px] font-semibold ring-1 transition " + (footageSrc === v ? "bg-black text-white ring-black" : "bg-white text-[#151c27] ring-[#e7eefe] hover:ring-[#c6c6cd]")}>{l}</button>
              ))}
            </div>
          </div>
        )}
        {/* Generate */}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-black text-white font-medium text-[14px] hover:bg-[#2a313d] transition-colors disabled:opacity-60"
        >
          <span className={"material-symbols-outlined text-[20px] " + (generating ? "animate-spin" : "")}>
            {generating ? "progress_activity" : "auto_awesome"}
          </span>
          {generating ? "Membuat konten…" : "Generate Konten dengan AI"}
          {!generating && <span className="font-mono text-[11px] opacity-60 ml-1">Ctrl/⌘+Enter</span>}
        </button>
      </div>

      {/* ===== KANAN: Studio Preview ===== */}
      <div className="lg:sticky lg:top-4">
        <div className="rounded-xl bg-white ring-1 ring-[#e7eefe] shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#e7eefe]">
            <h2 className="font-heading text-sm font-semibold text-[#151c27]">Studio Preview &amp; Review</h2>
            {result && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#e7eefe] text-[11px] font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-black inline-block" />
                {result.status === "ready" ? "Siap Rilis" : result.status === "failed" ? "Gagal" : "Diproses"}
              </span>
            )}
          </div>

          <div className="p-4">
            {!result && !captionResult && !generating && (
              <div className="h-80 flex flex-col items-center justify-center text-center gap-2 text-[#555f6d]">
                <span className="material-symbols-outlined text-[40px] text-[#c6c6cd]">movie_edit</span>
                <p className="text-[13px]">Hasil generate akan muncul di sini.</p>
                <p className="text-[11px]">Tulis ide di kiri, pilih format, lalu Generate.</p>
              </div>
            )}

            {captionResult && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#555f6d]">Caption &amp; Hashtag</p>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={saveCaptionDraft}
                      disabled={savingDraft}
                      className="text-[11px] text-[#151c27] hover:underline flex items-center gap-1 disabled:opacity-60"
                    >
                      <span className="material-symbols-outlined text-[14px]">bookmark_add</span> {savingDraft ? "Menyimpan…" : "Simpan Draft"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const hz = captionResult.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
                        navigator.clipboard?.writeText(`${captionResult.caption}\n\n${hz}`);
                        toast.success("Caption disalin");
                      }}
                      className="text-[11px] text-[#151c27] hover:underline flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-[14px]">content_copy</span> Salin
                    </button>
                  </div>
                </div>
                <div className="rounded-lg bg-[#f0f3ff] p-3 text-[13px] text-[#151c27] whitespace-pre-wrap max-h-[55vh] overflow-y-auto">
                  {captionResult.caption}
                  {captionResult.hashtags.length > 0 && (
                    <p className="text-[#555f6d] mt-3">{captionResult.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}</p>
                  )}
                </div>
              </div>
            )}

            {generating && (
              <div className="h-80 flex flex-col items-center justify-center text-center gap-3 text-[#555f6d]">
                <span className="material-symbols-outlined text-[40px] animate-spin text-[#151c27]">progress_activity</span>
                <p className="text-[13px]">AI sedang membuat kontenmu…</p>
                <p className="text-[11px]">Video bisa beberapa menit (sourcing footage + render). Jangan tutup halaman.</p>
              </div>
            )}

            {result && (
              <div className="space-y-4">
                {/* Media preview */}
                {(() => {
                  const media = result.assets?.find((a) => a.type === "final_video") || result.assets?.find((a) => a.type === "final_image") || result.assets?.find((a) => a.type === "thumbnail");
                  if (!media) return null;
                  return media.type === "final_video" ? (
                    <video src={proxiedUrl(media.fileUrl)} controls className="w-full rounded-lg bg-black max-h-96" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={proxiedUrl(media.fileUrl)} alt="" className="w-full rounded-lg object-contain max-h-96 bg-[#f0f3ff]" />
                  );
                })()}

                {/* Working title / hook (tanpa skor, PRD §14) */}
                {result.script && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[#555f6d] mb-1">Judul / Hook</p>
                    <p className="text-[15px] font-heading font-semibold text-[#151c27]">{result.script.split("\n")[0].slice(0, 140)}</p>
                  </div>
                )}

                {/* Caption studio - editable (Fase A 2026-10-05) */}
                {(result.generatedCaption || editing) && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#555f6d]">Caption &amp; Hashtag</p>
                      <div className="flex items-center gap-3">
                        {!editing && (
                          <button type="button" onClick={startEdit} className="text-[11px] text-[#151c27] hover:underline flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px]">edit</span> Edit
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const hz = (() => { try { return (JSON.parse(result.generatedHashtags || "[]") as string[]).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" "); } catch { return ""; } })();
                            navigator.clipboard?.writeText(`${result.generatedCaption}\n\n${hz}`);
                            toast.success("Caption disalin");
                          }}
                          className="text-[11px] text-[#151c27] hover:underline flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-[14px]">content_copy</span> Salin
                        </button>
                      </div>
                    </div>
                    {editing ? (
                      <div className="space-y-2">
                        <textarea value={edCaption} onChange={(e) => setEdCaption(e.target.value)} rows={5} placeholder="Caption" className="w-full rounded-lg ring-1 ring-[#e7eefe] focus:ring-[#c6c6cd] outline-none p-2.5 text-[13px] text-[#151c27] resize-y" />
                        <input value={edHashtags} onChange={(e) => setEdHashtags(e.target.value)} placeholder="#tag1 #tag2" className="w-full rounded-lg ring-1 ring-[#e7eefe] focus:ring-[#c6c6cd] outline-none p-2.5 text-[13px] text-[#151c27]" />
                        <div className="flex gap-2">
                          <button type="button" disabled={savingEdit} onClick={saveEdit} className="rounded-lg bg-black px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50">{savingEdit ? "Menyimpan…" : "Simpan"}</button>
                          <button type="button" onClick={() => setEditing(false)} className="rounded-lg bg-white px-3 py-1.5 text-[12px] font-semibold text-[#151c27] ring-1 ring-[#e7eefe] hover:ring-[#c6c6cd]">Batal</button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg bg-[#f0f3ff] p-3 text-[13px] text-[#151c27] whitespace-pre-wrap max-h-56 overflow-y-auto">
                        {result.generatedCaption}
                        {(() => { try { const h = JSON.parse(result.generatedHashtags || "[]") as string[]; return h.length ? <p className="text-[#555f6d] mt-2">{h.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ")}</p> : null; } catch { return null; } })()}
                      </div>
                    )}
                  </div>
                )}

                {result.status === "ready" && (
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-[#e7eefe] mt-1">
                    <button type="button" onClick={downloadAsset} className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-[12px] font-semibold text-[#151c27] ring-1 ring-[#e7eefe] hover:ring-[#c6c6cd]">
                      <span className="material-symbols-outlined text-[15px]">download</span> Download
                    </button>
                    <button type="button" disabled={generating} onClick={() => { if (confirm("Generate ulang? Hasil sekarang akan diganti.")) handleGenerate(); }} className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-[12px] font-semibold text-[#151c27] ring-1 ring-[#e7eefe] hover:ring-[#c6c6cd] disabled:opacity-50">
                      <span className="material-symbols-outlined text-[15px]">refresh</span> Generate Ulang
                    </button>
                    <button type="button" onClick={() => setShowFootage(true)} className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-[12px] font-semibold text-[#151c27] ring-1 ring-[#e7eefe] hover:ring-[#c6c6cd]">
                      <span className="material-symbols-outlined text-[15px]">swap_horiz</span> Ganti Footage
                    </button>
                    <button type="button" onClick={uploadToChannels} className="inline-flex items-center gap-1 rounded-lg bg-black px-3 py-2 text-[12px] font-semibold text-white hover:opacity-90">
                      <span className="material-symbols-outlined text-[15px]">publish</span> Upload ke Kanal
                    </button>
                  </div>
                )}

                {result.status === "failed" && result.errorMessage && (
                  <p className="text-[12px] text-[#ba1a1a]">{result.errorMessage}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {showFootage && result && (
        <FootageSwapModal
          brandId={brandId}
          projectId={result.id}
          onClose={() => setShowFootage(false)}
          onDone={async () => {
            const d = await fetch(`/api/projects/${result.id}`).then((x) => x.json());
            setResult(d);
          }}
        />
      )}
      {showUpload && result && (
        <UploadModal
          brandId={brandId}
          projectId={result.id}
          onClose={() => setShowUpload(false)}
          onDone={async () => {
            const d = await fetch(`/api/projects/${result.id}`).then((x) => x.json());
            setResult(d);
          }}
        />
      )}
    </div>
  );
}
