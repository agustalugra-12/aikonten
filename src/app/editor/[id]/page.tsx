"use client";

// Halaman Editor berdedikasi (Fase editor tab, 2026-10-29) - dibuka di TAB BROWSER BARU dari
// tombol "Edit Timeline" (DraftReview). Menyatukan SEMUA yang bisa diedit secara visual:
//   - Timeline (per-video): urutan scene, footage, trim, motion, transisi (reuse TimelineEditor).
//   - Gaya Visual (level brand): toggle Animated Title / Kinetic / Background / Animasi Harga.
// Terlindungi otomatis oleh proxy.ts (non-public -> wajib sesi). Client-side: panggil /api pakai cookie.
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TimelineEditor } from "@/components/dashboard/TimelineEditor";
import { VisualStylePanel } from "@/components/dashboard/VisualStylePanel";

export default function EditorPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : Array.isArray(params.id) ? params.id[0] : "";
  const [brandId, setBrandId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${id}`);
        if (!res.ok) throw new Error(res.status === 404 ? "Proyek tidak ditemukan." : "Gagal memuat proyek.");
        const p = (await res.json()) as { brandId?: string };
        if (!cancelled && p.brandId) setBrandId(p.brandId);
        else if (!cancelled) setError("Proyek tidak punya brand.");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Gagal memuat proyek.");
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  return (
    <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Timeline Editor</h1>
        <p className="text-sm text-muted-foreground">Atur scene & gaya visual video. Perubahan berlaku saat video dirender ulang.</p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {brandId ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Timeline</CardTitle>
              <CardDescription>Urutan scene, footage, trim, motion &amp; transisi (khusus video ini).</CardDescription>
            </CardHeader>
            <CardContent>
              <TimelineEditor projectId={id} brandId={brandId} onClose={() => window.close()} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Gaya Visual</CardTitle>
              <CardDescription>Elemen motion-graphic (berlaku untuk semua video brand ini).</CardDescription>
            </CardHeader>
            <CardContent>
              <VisualStylePanel brandId={brandId} />
            </CardContent>
          </Card>
        </>
      ) : (
        !error && <p className="text-sm text-muted-foreground">Memuat editor...</p>
      )}
    </main>
  );
}
