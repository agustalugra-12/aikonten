"use client";

// Timeline Editor - Fase 5A (foundation) + 5B (Scene Management, 2026-10-28).
// 5B: edit urutan scene (tambah/hapus/geser) + ganti/tambah footage dari Footage Bank + SIMPAN
// manual (PATCH Fase 4). Masih TANPA autosave/konflik/render (itu 5E). Proyek lama (scene_manifest
// NULL) di-seed in-memory & baru menulis DB saat user klik Simpan -> perubahan BERLAKU SAAT RENDER
// BERIKUTNYA (render tak dipicu di sini). Gaya visual tetap dari Brand Kit. Hemat RAM: tanpa
// banyak <video>, pakai bilah durasi.
import { type ReactNode, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { seedManifestFromProject, type SeedSource } from "@/lib/scene/seedManifest";
import { addScene, removeScene, moveScene, setSceneFootage, brollFootageFromBank, setSegmentTrim, setBrollDuration, setSceneMotion, setSceneTransition } from "@/lib/scene/manifestReducer";
import {
  estimateManifestDurationSeconds,
  validateSceneManifest,
  type Scene,
  type SceneManifest,
  type SceneOrientation,
} from "@/lib/render/sceneManifest";
import { ALL_MOTION_TYPES, type MotionType } from "@/lib/render/cameraMotion";
import { ALL_TRANSITION_TYPES_COMPLETE, type TransitionType } from "@/lib/render/transitions";

const ORIENTATIONS: readonly SceneOrientation[] = ["portrait", "landscape", "square"];
function isOrientation(v: unknown): v is SceneOrientation {
  return typeof v === "string" && (ORIENTATIONS as readonly string[]).includes(v);
}
function sceneDurationSeconds(scene: Scene): number {
  return scene.footage.kind === "segment" ? scene.footage.end - scene.footage.start : scene.footage.durationSeconds;
}

type BankItem = { id: string; mediaType: string; fileUrl: string; posterUrl?: string | null; durationSeconds?: number | null; description?: string };

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; manifest: SceneManifest | null; source: SeedSource; serverManifest: string | null };

export function TimelineEditor({ projectId, brandId, onClose, onChange }: { projectId: string; brandId: string; onClose: () => void; onChange?: () => void }) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });

  useEffect(() => {
    // State awal "loading"; deps stabil per kartu -> effect sekali. Tak setState sinkron di body.
    let cancelled = false;
    (async () => {
      try {
        const projRes = await fetch(`/api/projects/${projectId}`);
        if (!projRes.ok) throw new Error(projRes.status === 404 ? "Proyek tidak ditemukan." : "Gagal memuat proyek.");
        const proj = (await projRes.json()) as { clipSelection?: string | null; sceneManifest?: string | null };
        let orientation: SceneOrientation = "portrait";
        try {
          const brandRes = await fetch(`/api/brands/${brandId}`);
          if (brandRes.ok) {
            const brand = (await brandRes.json()) as { videoOrientation?: unknown };
            if (isOrientation(brand.videoOrientation)) orientation = brand.videoOrientation;
          }
        } catch {
          /* default portrait */
        }
        const { manifest, source } = seedManifestFromProject({ sceneManifest: proj.sceneManifest, clipSelection: proj.clipSelection, orientation });
        if (!cancelled) setState({ phase: "ready", manifest, source, serverManifest: proj.sceneManifest ?? null });
      } catch (err) {
        if (!cancelled) setState({ phase: "error", message: err instanceof Error ? err.message : "Terjadi kesalahan." });
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, brandId]);

  if (state.phase === "loading") return <p className="text-sm text-muted-foreground py-6 text-center">Memuat timeline...</p>;
  if (state.phase === "error")
    return (
      <div className="py-6 text-center space-y-2">
        <p className="text-sm text-destructive">{state.message}</p>
        <Button variant="outline" size="sm" onClick={onClose}>Tutup</Button>
      </div>
    );
  if (!state.manifest || state.manifest.scenes.length === 0)
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        Belum ada data scene untuk proyek ini. Timeline hanya tersedia untuk video dengan footage.
      </p>
    );
  return <EditorView projectId={projectId} brandId={brandId} initial={state.manifest} source={state.source} serverManifest={state.serverManifest} onClose={onClose} onChange={onChange} />;
}

function EditorView({ projectId, brandId, initial, source, serverManifest, onClose, onChange }: { projectId: string; brandId: string; initial: SceneManifest; source: SeedSource; serverManifest: string | null; onClose: () => void; onChange?: () => void }) {
  const [manifest, setManifest] = useState<SceneManifest>(initial);
  const [baseline, setBaseline] = useState<string>(() => JSON.stringify(initial));
  // Keadaan DB yg kita ketahui (null = proyek lama belum punya manifest). Dipakai deteksi konflik.
  const [serverStr, setServerStr] = useState<string | null>(serverManifest);
  const [selectedId, setSelectedId] = useState<string | null>(initial.scenes[0]?.id ?? null);
  const [saving, setSaving] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [picker, setPicker] = useState<{ mode: "add" } | { mode: "replace"; sceneId: string } | null>(null);

  const manifestStr = JSON.stringify(manifest);
  const dirty = manifestStr !== baseline;
  const totalDuration = estimateManifestDurationSeconds(manifest);
  const busy = saving || rendering;

  function apply(next: SceneManifest) {
    setManifest(next);
    setSaveError(null);
  }

  function handlePick(item: BankItem) {
    const footage = brollFootageFromBank(item.fileUrl, item.durationSeconds);
    if (picker?.mode === "add") {
      const id = crypto.randomUUID();
      apply(addScene(manifest, footage, id));
      setSelectedId(id);
    } else if (picker?.mode === "replace") {
      apply(setSceneFootage(manifest, picker.sceneId, footage));
    }
    setPicker(null);
  }

  // Simpan inti (dipakai tombol Simpan, autosave, & sebelum Render). Return true kalau tersimpan
  // atau memang tak ada perubahan. Validasi client dulu (server tetap otoritas 400). Deteksi
  // konflik BEST-EFFORT tanpa ubah server: GET manifest terkini; kalau beda dari keadaan DB yg
  // kita tahu (serverStr) -> ada yg mengubah di tempat lain -> batalkan & minta muat ulang.
  async function save(): Promise<boolean> {
    if (JSON.stringify(manifest) === baseline) return true;
    const v = validateSceneManifest(manifest);
    if (!v.ok) { setSaveError(`Timeline belum valid: ${v.error}`); return false; }
    setSaving(true);
    setSaveError(null);
    try {
      try {
        const g = await fetch(`/api/projects/${projectId}`);
        if (g.ok) {
          const gj = (await g.json()) as { sceneManifest?: string | null };
          if ((gj.sceneManifest ?? null) !== serverStr) { setConflict(true); return false; }
        }
      } catch {
        /* cek konflik opsional - kalau gagal, jangan blokir penyimpanan */
      }
      const r = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneManifest: manifest }),
      });
      if (!r.ok) {
        const e = (await r.json().catch(() => ({}))) as { error?: string };
        setSaveError(e.error || (r.status === 404 ? "Proyek tidak ditemukan." : `Gagal menyimpan (${r.status}).`));
        return false;
      }
      const savedStr = JSON.stringify(manifest);
      setBaseline(savedStr);
      setServerStr(savedStr);
      return true;
    } catch {
      setSaveError("Gagal menyimpan - masalah jaringan.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (await save()) toast.success("Timeline tersimpan. Perubahan berlaku saat render berikutnya.");
  }

  // Render ulang: simpan dulu kalau ada perubahan, konfirmasi (berbayar kredit), lalu POST /process
  // (pipeline existing -> baca manifest tersimpan via wiring Fase 4). Tak duplikasi logika render.
  async function handleRender() {
    if (dirty && !(await save())) return;
    if (!confirm("Render ulang video dengan timeline ini? Proses ini memakai kredit generate.")) return;
    setRendering(true);
    setSaveError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/process`, { method: "POST" });
      if (!r.ok) {
        const e = (await r.json().catch(() => ({}))) as { error?: string };
        setSaveError(e.error || `Gagal memulai render (${r.status}).`);
        return;
      }
      toast.success("Render dimulai. Hasil akan muncul di draft setelah selesai.");
      onChange?.();
      onClose();
    } catch {
      setSaveError("Gagal memulai render - masalah jaringan.");
    } finally {
      setRendering(false);
    }
  }

  // Autosave: 2.5 dtk setelah perubahan berhenti (hanya kalau dirty, tak sibuk, tak konflik).
  // Pakai timer (bukan setState sinkron di body effect). Manifest selalu valid (reducer menjaga).
  useEffect(() => {
    if (!dirty || busy || conflict) return;
    const t = setTimeout(() => { void save(); }, 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifestStr, dirty, busy, conflict]);

  // Guard kehilangan perubahan: peringatkan kalau keluar/refresh saat masih ada perubahan belum tersimpan.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const scenes = manifest.scenes;
  const selectedScene = scenes.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="capitalize">{manifest.orientation}</Badge>
          <Badge variant="secondary">{scenes.length} scene</Badge>
          <span className="text-xs text-muted-foreground">~{totalDuration.toFixed(1)}s</span>
          {dirty && <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-600">Belum disimpan</Badge>}
        </div>
        <Badge variant={source === "stored" ? "default" : "outline"} className="text-xs">
          {source === "stored" ? "Timeline tersimpan" : "Draf dari footage"}
        </Badge>
      </div>

      {/* Track scene (klik utk pilih). Bilah proporsional ke durasi. */}
      <div className="overflow-x-auto">
        <div className="flex items-stretch gap-1 min-w-full pb-1">
          {scenes.map((scene, i) => {
            const dur = sceneDurationSeconds(scene);
            const sel = scene.id === selectedId;
            return (
              <div key={scene.id} className="flex items-stretch gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedId(scene.id)}
                  className={"rounded-md border px-2 py-2 flex flex-col justify-between text-left " + (sel ? "border-foreground bg-muted" : "border-border bg-muted/40 hover:border-muted-foreground")}
                  style={{ width: `${Math.max(64, Math.round(dur * 28))}px` }}
                  title={`Scene ${i + 1} - ${scene.footage.kind} - ${dur.toFixed(1)}s`}
                >
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-mono text-muted-foreground">#{i + 1}</span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0 capitalize">{scene.footage.kind}</Badge>
                  </div>
                  <span className="text-[10px] text-foreground font-medium">{dur.toFixed(1)}s</span>
                  <span className="text-[9px] text-muted-foreground truncate">{scene.motion ?? "static"}</span>
                </button>
                {i < scenes.length - 1 && (
                  <div className="flex items-center" title={`Transisi: ${scene.transitionAfter ?? "default (fade)"}`}>
                    <span className="text-[9px] text-muted-foreground px-0.5">→{scene.transitionAfter ?? "fade"}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Kontrol scene terpilih */}
      {selectedId && (
        <div className="flex items-center gap-2 flex-wrap border rounded-md p-2">
          <span className="text-xs text-muted-foreground">Scene terpilih:</span>
          <Button variant="outline" size="sm" onClick={() => apply(moveScene(manifest, selectedId, "up"))} disabled={scenes.findIndex((s) => s.id === selectedId) === 0}>← Geser</Button>
          <Button variant="outline" size="sm" onClick={() => apply(moveScene(manifest, selectedId, "down"))} disabled={scenes.findIndex((s) => s.id === selectedId) === scenes.length - 1}>Geser →</Button>
          <Button variant="outline" size="sm" onClick={() => setPicker({ mode: "replace", sceneId: selectedId })}>Ganti footage</Button>
          <Button variant="destructive" size="sm" onClick={() => apply(removeScene(manifest, selectedId))} disabled={scenes.length <= 1}>Hapus</Button>
        </div>
      )}

      {selectedScene && (
        <SceneInspector
          key={`${selectedScene.id}:${selectedScene.footage.kind}`}
          scene={selectedScene}
          isLast={scenes[scenes.length - 1]?.id === selectedScene.id}
          onTrim={(s, e) => {
            const r = setSegmentTrim(manifest, selectedScene.id, s, e);
            if (r.ok) { apply(r.manifest); return null; }
            return r.error;
          }}
          onDuration={(d) => {
            const r = setBrollDuration(manifest, selectedScene.id, d);
            if (r.ok) { apply(r.manifest); return null; }
            return r.error;
          }}
          onMotion={(mt) => apply(setSceneMotion(manifest, selectedScene.id, mt))}
          onTransition={(tt) => apply(setSceneTransition(manifest, selectedScene.id, tt))}
        />
      )}

      {conflict && (
        <div className="rounded-md border border-amber-500 bg-amber-50 p-2 text-xs text-amber-700 flex items-center justify-between gap-2">
          <span>Timeline ini diubah di tempat lain. Tutup lalu buka lagi untuk memuat versi terbaru (perubahanmu belum tersimpan).</span>
          <Button variant="outline" size="sm" onClick={onClose}>Tutup</Button>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={() => setPicker({ mode: "add" })} disabled={busy}>+ Tambah Scene</Button>
        <div className="flex items-center gap-2">
          {saveError && <span className="text-xs text-destructive max-w-xs truncate" title={saveError}>{saveError}</span>}
          <Button variant="outline" size="sm" onClick={handleSave} disabled={busy || !dirty}>{saving ? "Menyimpan..." : "Simpan"}</Button>
          <Button size="sm" onClick={handleRender} disabled={busy}>{rendering ? "Merender..." : "Render ulang"}</Button>
        </div>
      </div>

      {picker && <BankPicker brandId={brandId} onPick={handlePick} onClose={() => setPicker(null)} />}

      <p className="text-xs text-muted-foreground border-t pt-2">
        Gaya visual (subtitle, judul, animasi, background) diatur dari <span className="font-medium">Brand Kit</span>, bukan di sini.
        Trim klip serta pengaturan motion & transisi menyusul di tahap berikutnya. Menyimpan tidak me-render ulang — perubahan berlaku saat render berikutnya.
      </p>
    </div>
  );
}

// Inspector properti klip (Fase 5C). Di-key per (sceneId:kind) di induk -> remount & reset input
// saat ganti scene atau kind footage berubah. Input lokal (string) agar bisa mengetik nilai
// antara yg belum valid tanpa memasukkannya ke manifest; commit memanggil onTrim/onDuration yg
// balikkan pesan error (null = sukses & manifest sudah diperbarui induk).
function SceneInspector({
  scene,
  isLast,
  onTrim,
  onDuration,
  onMotion,
  onTransition,
}: {
  scene: Scene;
  isLast: boolean;
  onTrim: (start: number, end: number) => string | null;
  onDuration: (durationSeconds: number) => string | null;
  onMotion: (motion: MotionType) => void;
  onTransition: (transition: TransitionType | undefined) => void;
}) {
  const footage = scene.footage;
  const [startStr, setStartStr] = useState(footage.kind === "segment" ? String(footage.start) : "");
  const [endStr, setEndStr] = useState(footage.kind === "segment" ? String(footage.end) : "");
  const [durStr, setDurStr] = useState(footage.kind === "broll" ? String(footage.durationSeconds) : "");
  const [err, setErr] = useState<string | null>(null);

  let footageFields: ReactNode;
  if (footage.kind === "segment") {
    const commit = (ns: string, ne: string) => setErr(onTrim(parseFloat(ns), parseFloat(ne)));
    const dur = Math.max(0, (parseFloat(endStr) || 0) - (parseFloat(startStr) || 0));
    footageFields = (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Trim segment (detik):</span>
        <label className="text-xs flex items-center gap-1">start
          <input type="number" min={0} step={0.1} value={startStr}
            onChange={(e) => { setStartStr(e.target.value); commit(e.target.value, endStr); }}
            className="w-20 border rounded px-1.5 py-1 text-xs" />
        </label>
        <label className="text-xs flex items-center gap-1">end
          <input type="number" min={0} step={0.1} value={endStr}
            onChange={(e) => { setEndStr(e.target.value); commit(startStr, e.target.value); }}
            className="w-20 border rounded px-1.5 py-1 text-xs" />
        </label>
        <span className="text-xs text-muted-foreground">durasi {dur.toFixed(1)}s</span>
      </div>
    );
  } else {
    const commitDur = (nd: string) => setErr(onDuration(parseFloat(nd)));
    footageFields = (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Durasi b-roll (detik):</span>
        <input type="number" min={0.1} step={0.1} value={durStr}
          onChange={(e) => { setDurStr(e.target.value); commitDur(e.target.value); }}
          className="w-24 border rounded px-1.5 py-1 text-xs" />
      </div>
    );
  }

  return (
    <div className="border rounded-md p-2 space-y-2">
      {footageFields}
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="flex items-center gap-3 flex-wrap border-t pt-2">
        <label className="text-xs flex items-center gap-1">Motion
          <select value={scene.motion ?? "static"} onChange={(e) => onMotion(e.target.value as MotionType)} className="border rounded px-1.5 py-1 text-xs">
            {ALL_MOTION_TYPES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        {!isLast && (
          <label className="text-xs flex items-center gap-1">Transisi sesudah
            <select value={scene.transitionAfter ?? ""} onChange={(e) => onTransition(e.target.value === "" ? undefined : (e.target.value as TransitionType))} className="border rounded px-1.5 py-1 text-xs">
              <option value="">default (fade)</option>
              {ALL_TRANSITION_TYPES_COMPLETE.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}

// Picker Footage Bank (reuse endpoint existing GET /api/brands/[id]/footage-bank). Fetch saat
// dibuka (bukan di effect global) -> hanya saat dibutuhkan, tanpa setState-in-effect sinkron.
function BankPicker({ brandId, onPick, onClose }: { brandId: string; onPick: (item: BankItem) => void; onClose: () => void }) {
  const [items, setItems] = useState<BankItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/brands/${brandId}/footage-bank`);
        if (!r.ok) throw new Error();
        const data = (await r.json()) as BankItem[];
        if (!cancelled) setItems(Array.isArray(data) ? data.filter((d) => d.mediaType === "video") : []);
      } catch {
        if (!cancelled) setError("Gagal memuat Footage Bank.");
      }
    })();
    return () => { cancelled = true; };
  }, [brandId]);

  return (
    <div className="border rounded-md p-2 space-y-2 bg-muted/30">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">Pilih footage (video) dari Bank</span>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onClose}>Tutup</Button>
      </div>
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : !items ? (
        <p className="text-xs text-muted-foreground">Memuat...</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Belum ada footage video di Bank brand ini.</p>
      ) : (
        <div className="grid grid-cols-4 gap-2 max-h-56 overflow-y-auto">
          {items.map((it) => (
            <button key={it.id} type="button" onClick={() => onPick(it)} className="relative aspect-square rounded-md overflow-hidden ring-1 ring-border hover:ring-foreground" title={it.description || it.fileUrl}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.posterUrl || `/api/media-proxy?url=${encodeURIComponent(it.fileUrl)}`} alt="" className="w-full h-full object-cover bg-muted" />
              {typeof it.durationSeconds === "number" && it.durationSeconds > 0 && (
                <span className="absolute bottom-0.5 right-0.5 text-[9px] bg-black/70 text-white px-1 rounded">{it.durationSeconds}s</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
