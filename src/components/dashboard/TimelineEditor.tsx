"use client";

// Timeline Editor - Fase 5A (Timeline Foundation, 2026-10-28). READ-ONLY: muat manifest proyek
// (atau seed dari footage utk proyek lama) & tampilkan urutan scene + estimasi durasi. BELUM ada
// mutasi/simpan (itu 5B-5E) -> NOL perubahan perilaku render prod. Gaya visual tetap dari Brand
// Kit (tak diatur di sini). Tak memuat banyak <video> (hemat RAM VPS 4GB) - pakai bilah durasi.
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { seedManifestFromProject, type SeedSource } from "@/lib/scene/seedManifest";
import {
  estimateManifestDurationSeconds,
  type Scene,
  type SceneManifest,
  type SceneOrientation,
} from "@/lib/render/sceneManifest";

const ORIENTATIONS: readonly SceneOrientation[] = ["portrait", "landscape", "square"];

function isOrientation(v: unknown): v is SceneOrientation {
  return typeof v === "string" && (ORIENTATIONS as readonly string[]).includes(v);
}

function sceneDurationSeconds(scene: Scene): number {
  return scene.footage.kind === "segment"
    ? scene.footage.end - scene.footage.start
    : scene.footage.durationSeconds;
}

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; manifest: SceneManifest | null; source: SeedSource };

export function TimelineEditor({
  projectId,
  brandId,
  onClose,
}: {
  projectId: string;
  brandId: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });

  useEffect(() => {
    // State awal sudah "loading"; deps (projectId/brandId) stabil selama komponen hidup (1 kartu
    // draft = 1 proyek) jadi effect jalan sekali. TIDAK setState sinkron di sini (aturan
    // react-hooks/set-state-in-effect) - hasil di-set async saat fetch selesai/gagal.
    let cancelled = false;

    (async () => {
      try {
        // Proyek: clipSelection (seed) + sceneManifest (tersimpan). Field ini TIDAK ada di type
        // Project frontend tapi GET /api/projects/[id] me-spread seluruh row + sceneManifest.
        const projRes = await fetch(`/api/projects/${projectId}`);
        if (!projRes.ok) throw new Error(projRes.status === 404 ? "Proyek tidak ditemukan." : "Gagal memuat proyek.");
        const proj = (await projRes.json()) as { clipSelection?: string | null; sceneManifest?: string | null };

        // Orientasi brand utk seed (hanya dipakai kalau manifest belum tersimpan). Gagal -> default
        // "portrait" (sama default renderer) supaya editor tetap jalan.
        let orientation: SceneOrientation = "portrait";
        try {
          const brandRes = await fetch(`/api/brands/${brandId}`);
          if (brandRes.ok) {
            const brand = (await brandRes.json()) as { videoOrientation?: unknown };
            if (isOrientation(brand.videoOrientation)) orientation = brand.videoOrientation;
          }
        } catch {
          /* biarkan default portrait */
        }

        const { manifest, source } = seedManifestFromProject({
          sceneManifest: proj.sceneManifest,
          clipSelection: proj.clipSelection,
          orientation,
        });
        if (!cancelled) setState({ phase: "ready", manifest, source });
      } catch (err) {
        if (!cancelled) setState({ phase: "error", message: err instanceof Error ? err.message : "Terjadi kesalahan." });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, brandId]);

  return (
    <div className="space-y-4">
      {state.phase === "loading" && <p className="text-sm text-muted-foreground py-6 text-center">Memuat timeline...</p>}

      {state.phase === "error" && (
        <div className="py-6 text-center space-y-2">
          <p className="text-sm text-destructive">{state.message}</p>
          <Button variant="outline" size="sm" onClick={onClose}>Tutup</Button>
        </div>
      )}

      {state.phase === "ready" && <ReadyView manifest={state.manifest} source={state.source} />}
    </div>
  );
}

function ReadyView({ manifest, source }: { manifest: SceneManifest | null; source: SeedSource }) {
  if (!manifest || manifest.scenes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        Belum ada data scene untuk proyek ini. Timeline hanya tersedia untuk video dengan footage.
      </p>
    );
  }

  const totalDuration = estimateManifestDurationSeconds(manifest);
  const scenes = manifest.scenes;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="capitalize">{manifest.orientation}</Badge>
          <Badge variant="secondary">{scenes.length} scene</Badge>
          <span className="text-xs text-muted-foreground">~{totalDuration.toFixed(1)}s estimasi durasi</span>
        </div>
        <Badge variant={source === "stored" ? "default" : "outline"} className="text-xs">
          {source === "stored" ? "Timeline tersimpan" : "Draf dari footage (belum disimpan)"}
        </Badge>
      </div>

      {/* Track horizontal: lebar bilah proporsional terhadap durasi scene. */}
      <div className="overflow-x-auto">
        <div className="flex items-stretch gap-1 min-w-full pb-1">
          {scenes.map((scene, i) => {
            const dur = sceneDurationSeconds(scene);
            return (
              <div key={scene.id} className="flex items-stretch gap-1 shrink-0">
                <div
                  className="rounded-md border bg-muted/40 px-2 py-2 flex flex-col justify-between"
                  style={{ width: `${Math.max(64, Math.round(dur * 28))}px` }}
                  title={`Scene ${i + 1} - ${scene.footage.kind} - ${dur.toFixed(1)}s`}
                >
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-mono text-muted-foreground">#{i + 1}</span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0 capitalize">{scene.footage.kind}</Badge>
                  </div>
                  <span className="text-[10px] text-foreground font-medium">{dur.toFixed(1)}s</span>
                  <span className="text-[9px] text-muted-foreground truncate">{scene.motion ?? "static"}</span>
                </div>
                {i < scenes.length - 1 && (
                  <div className="flex items-center" title={`Transisi: ${scene.transitionAfter ?? "default (fade)"}`}>
                    <span className="text-[9px] text-muted-foreground px-0.5">
                      →{scene.transitionAfter ?? "fade"}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-muted-foreground border-t pt-2">
        Gaya visual (subtitle, judul, animasi teks, background) tetap diatur dari <span className="font-medium">Brand Kit</span>, bukan di timeline ini.
        {source !== "stored" && " Timeline ini draf dari footage proyek — mengedit & menyimpan akan tersedia di tahap berikutnya."}
      </p>
    </div>
  );
}
