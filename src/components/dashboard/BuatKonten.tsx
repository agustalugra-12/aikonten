"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Brand, ProjectDetail } from "@/types";

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
  { key: "caption", label: "Caption Only", icon: "notes", desc: "Caption saja (segera)", ready: false },
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
  const taRef = useRef<HTMLTextAreaElement | null>(null);

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
    try {
      // 1) Tulis-balik tone/audiens ke config brand existing (PRD §10) bila diisi/diubah.
      const patch: Record<string, string> = {};
      if (tone && tone !== (brand?.toneOfVoice || "")) patch.toneOfVoice = tone;
      if (audience && audience !== (brand?.targetAudience || "")) patch.targetAudience = audience;
      if (Object.keys(patch).length > 0) {
        await fetch(`/api/brands/${brandId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
      }

      // 2) Generate lewat engine NYATA (runAutoContent) - prompt jadi `script`.
      const res = await fetch(`/api/brands/${brandId}/auto-content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: prompt.trim(), type: fmt }),
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
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-2xl font-bold tracking-tight text-[#151c27]">Buat Konten</h1>
            <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-black text-white">v2 Studio</span>
          </div>
          <p className="text-[13px] text-[#555f6d] mt-1">
            Ubah ide mentah menjadi storyboard, visual, dan caption siap rilis — pakai engine AI KontenPilot.
          </p>
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
            {!result && !generating && (
              <div className="h-80 flex flex-col items-center justify-center text-center gap-2 text-[#555f6d]">
                <span className="material-symbols-outlined text-[40px] text-[#c6c6cd]">movie_edit</span>
                <p className="text-[13px]">Hasil generate akan muncul di sini.</p>
                <p className="text-[11px]">Tulis ide di kiri, pilih format, lalu Generate.</p>
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

                {/* Caption studio */}
                {result.generatedCaption && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#555f6d]">Caption &amp; Hashtag</p>
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
                    <div className="rounded-lg bg-[#f0f3ff] p-3 text-[13px] text-[#151c27] whitespace-pre-wrap max-h-56 overflow-y-auto">
                      {result.generatedCaption}
                    </div>
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
    </div>
  );
}
