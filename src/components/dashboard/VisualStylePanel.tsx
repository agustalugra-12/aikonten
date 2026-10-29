"use client";

// Panel Gaya Visual (Fase editor tab, 2026-10-29) - toggle elemen motion-graphic level BRAND
// (berlaku utk SEMUA video brand, bukan per-video). Baca brandKit via GET /api/brands (list),
// toggle enabled tiap seksi (title/kinetic/background/price) MEMPERTAHANKAN preset/warna lain,
// simpan via PATCH /api/brands/[id]. Dipakai di halaman /editor/[id].
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

  return (
    <div className="space-y-3">
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
