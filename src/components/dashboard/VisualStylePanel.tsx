"use client";

// Panel Gaya Visual (Fase editor tab, 2026-10-29) - toggle elemen motion-graphic level BRAND
// (berlaku utk SEMUA video brand, bukan per-video). Baca brandKit via GET /api/brands (list),
// toggle enabled tiap seksi (title/kinetic/background/price) MEMPERTAHANKAN preset/warna lain,
// simpan via PATCH /api/brands/[id]. Dipakai di halaman /editor/[id].
// 2026-11-02: + kontrol Mesin Render (ffmpeg/HyperFrames) & Look grade (self-serve, dulu via DB).
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Kit = Record<string, unknown>;
type Brand = { id: string; brandKit?: string | null };

const FEATURES: { key: string; label: string; desc: string }[] = [
  { key: "title", label: "Animated Title", desc: "Judul/hook beranimasi di awal video" },
  { key: "kineticTypography", label: "Kinetic Typography", desc: "Teks hook bergerak (pop/slide)" },
  { key: "backgroundAnimation", label: "Background Animation", desc: "Latar belakang bermain (ambient/gradient)" },
  { key: "priceOverlay", label: "Animasi Harga", desc: "Kartu harga (Rp) beranimasi, bukan cuma subtitle" },
];

// Look grade HyperFrames (lihat hyperframesComposition.ts LOOKS). "" = Otomatis (AI Director pilih).
const LOOKS: { value: string; label: string }[] = [
  { value: "", label: "Otomatis (AI pilih sesuai mood)" },
  { value: "clean", label: "Clean — halus & netral" },
  { value: "cinematic", label: "Cinematic — teal-orange dramatis" },
  { value: "warm", label: "Warm — hangat / cozy" },
  { value: "cool", label: "Cool — biru tenang" },
  { value: "vivid", label: "Vivid — cerah energik" },
  { value: "mono", label: "Mono — hitam-putih berkelas" },
];

function isEnabled(kit: Kit, key: string): boolean {
  const sec = kit[key];
  return typeof sec === "object" && sec !== null && (sec as Record<string, unknown>).enabled === true;
}

export function VisualStylePanel({ brandId }: { brandId: string }) {
  const [kit, setKit] = useState<Kit | null>(null);
  const [baseline, setBaseline] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/brands");
        if (!res.ok) throw new Error();
        const brands = (await res.json()) as Brand[];
        const b = Array.isArray(brands) ? brands.find((x) => x.id === brandId) : undefined;
        let parsed: Kit = {};
        if (b?.brandKit) {
          try { parsed = JSON.parse(b.brandKit) as Kit; } catch { parsed = {}; }
        }
        if (!cancelled) { setKit(parsed); setBaseline(JSON.stringify(parsed)); setLoading(false); }
      } catch {
        if (!cancelled) { setError("Gagal memuat Gaya Visual."); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [brandId]);

  function toggle(key: string) {
    setKit((prev) => {
      const next: Kit = { ...(prev ?? {}) };
      const sec = { ...((next[key] as Record<string, unknown>) ?? {}) };
      sec.enabled = !(sec.enabled === true);
      next[key] = sec;
      return next;
    });
    setError(null);
  }

  // Set/hapus field top-level brandKit (string kosong/undefined = hapus -> jatuh ke default/auto).
  function setField(key: string, value: string | undefined) {
    setKit((prev) => {
      const next: Kit = { ...(prev ?? {}) };
      if (value === undefined || value === "") delete next[key];
      else next[key] = value;
      return next;
    });
    setError(null);
  }

  async function save() {
    if (!kit) return;
    setSaving(true); setError(null);
    try {
      const r = await fetch(`/api/brands/${brandId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandKit: kit }),
      });
      if (!r.ok) {
        const e = (await r.json().catch(() => ({}))) as { error?: string };
        setError(e.error || `Gagal menyimpan (${r.status}).`);
        return;
      }
      setBaseline(JSON.stringify(kit));
      toast.success("Gaya Visual tersimpan. Berlaku saat video brand ini dirender berikutnya.");
    } catch {
      setError("Gagal menyimpan - masalah jaringan.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground py-4">Memuat Gaya Visual...</p>;
  if (error && !kit) return <p className="text-sm text-destructive py-4">{error}</p>;
  if (!kit) return null;

  const dirty = JSON.stringify(kit) !== baseline;
  const hf = kit.renderEngine === "hyperframes";
  const look = typeof kit.look === "string" ? kit.look : "";

  return (
    <div className="space-y-3">
      {/* Mesin Render + Look (2026-11-02) - sinematik HyperFrames vs standar ffmpeg */}
      <div className="rounded-md border p-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="text-sm font-medium">Mesin Render</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span className="font-medium">HyperFrames</span> = editing sinematik (camera motion, grade warna, transisi, data block). <span className="font-medium">Standar</span> = pipeline lama.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setField("renderEngine", hf ? undefined : "hyperframes")}
            className={"shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors " + (hf ? "bg-foreground text-background border-foreground" : "bg-muted text-muted-foreground border-border hover:border-muted-foreground")}
          >
            {hf ? "HyperFrames (sinematik)" : "Standar"}
          </button>
        </div>
        {hf && (
          <div>
            <label className="text-sm font-medium" htmlFor="look-select">Look / Grade Warna</label>
            <select
              id="look-select"
              value={look}
              onChange={(e) => setField("look", e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              {LOOKS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
            <p className="text-xs text-muted-foreground mt-1">Pilihanmu MENANG atas AI. &quot;Otomatis&quot; = AI Director pilih grade sesuai mood tiap konten.</p>
          </div>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {FEATURES.map((f) => {
          const on = isEnabled(kit, f.key);
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => toggle(f.key)}
              className={"text-left rounded-md border p-3 transition-colors " + (on ? "border-foreground bg-muted" : "border-border hover:border-muted-foreground")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{f.label}</span>
                <span className={"text-[10px] px-1.5 py-0.5 rounded-full " + (on ? "bg-green-600 text-white" : "bg-muted-foreground/20 text-muted-foreground")}>
                  {on ? "AKTIF" : "mati"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{f.desc}</p>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        {error && <span className="text-xs text-destructive">{error}</span>}
        <Button size="sm" onClick={save} disabled={saving || !dirty} className="ml-auto">
          {saving ? "Menyimpan..." : "Simpan Gaya Visual"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Pengaturan ini <span className="font-medium">berlaku untuk semua video brand ini</span> (bukan per-video). Preset &amp; warna detail diatur di Brand Settings.
      </p>
    </div>
  );
}
