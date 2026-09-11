"use client";

import { useFetchedData } from "@/lib/useFetchedData";
import { FootageBankDialog } from "@/components/dashboard/FootageBankDialog";

// Halaman Library (galeri footage) - port gaya mockup KontenPilot (2026-09-11): grid
// kartu media dgn thumbnail, badge tipe+durasi, judul (deskripsi AI), tag. Data NYATA
// dari /api/brands/[id]/footage-bank. Field mockup yg TIDAK ada di backend (ukuran MB,
// resolusi 4K/1080p, storage gauge) SENGAJA tidak ditampilkan - hindari angka palsu.
// Ikon pakai Material Symbols (font sudah di-load di layout). Upload/manage tetap lewat
// FootageBankDialog yg sudah ada.

type Footage = {
  id: string;
  mediaType: "video" | "image";
  fileUrl: string;
  posterUrl: string | null;
  description: string;
  tags: string[];
  durationSeconds: number | null;
  createdAt: string;
};

function proxiedUrl(fileUrl: string): string {
  return `/api/media-proxy?url=${encodeURIComponent(fileUrl)}`;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function LibraryFootage({ brandId }: { brandId: string }) {
  const { data: items } = useFetchedData<Footage[]>(
    () => fetch(`/api/brands/${brandId}/footage-bank`).then((r) => r.json()),
    [brandId]
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[#555f6d]">
            <span>Asset Library</span>
            <span className="text-[#c6c6cd]">/</span>
            <span className="text-[#151c27] font-semibold">Footage &amp; B-Roll</span>
          </div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-[#151c27] mt-1">Library</h1>
          <p className="text-[13px] text-[#555f6d] mt-0.5">
            Koleksi video &amp; foto mentah brand ini untuk produksi konten.
          </p>
        </div>
        <FootageBankDialog brandId={brandId} />
      </div>

      {/* Grid galeri */}
      {!items ? (
        <p className="text-[13px] text-[#555f6d] py-10 text-center">Memuat...</p>
      ) : items.length === 0 ? (
        <p className="text-[13px] text-[#555f6d] py-10 text-center">Belum ada footage. Unggah lewat tombol di atas.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map((it) => {
            const thumb = it.mediaType === "video" ? it.posterUrl : it.fileUrl;
            return (
              <div
                key={it.id}
                className="group flex flex-col bg-white rounded-xl overflow-hidden shadow-sm ring-1 ring-[#e7eefe] hover:shadow-md transition-all"
              >
                <div className="relative w-full aspect-video bg-[#e7eefe] overflow-hidden">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={proxiedUrl(thumb)}
                      alt=""
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="material-symbols-outlined text-[28px] text-[#76777d]">
                        {it.mediaType === "video" ? "movie" : "image"}
                      </span>
                    </div>
                  )}
                  <div className="absolute top-2 left-2 flex items-center gap-1">
                    <span className="px-1.5 py-0.5 rounded bg-white/90 backdrop-blur-sm text-[#151c27] text-[10px] font-semibold uppercase flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">
                        {it.mediaType === "video" ? "smart_display" : "image"}
                      </span>
                      {it.mediaType === "video" ? "Video" : "Foto"}
                    </span>
                  </div>
                  {it.mediaType === "video" && it.durationSeconds != null && (
                    <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-[#2a313d]/85 text-[#ebf1ff] text-[10px] font-mono flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">schedule</span>
                      {formatDuration(it.durationSeconds)}
                    </span>
                  )}
                </div>
                <div className="p-3 flex flex-col flex-1">
                  <p className="text-[13px] font-medium text-[#151c27] line-clamp-2">{it.description || "(tanpa deskripsi)"}</p>
                  {it.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {it.tags.slice(0, 4).map((t, i) => (
                        <span key={i} className="px-1.5 py-0.5 rounded bg-[#f0f3ff] text-[#555f6d] text-[11px]">
                          #{t.replace(/^#/, "")}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
