"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useFetchedData } from "@/lib/useFetchedData";
import type { Brand } from "@/types";

// "⚡ Konten Otomatis" (lihat memory proyek - "otomatis seperti AI blog") - SATU klik,
// tanpa dialog/input apa pun: server sendiri yg usul ide (kalau perlu), cocokkan ke
// Footage Bank, proses, & publish. Lihat /api/brands/[id]/auto-content.
//
// (2026-09-02) Dropdown "Inspiration" (PRD Agustap Studio §2.19) - HANYA muncul kalau
// brand ini Agustap Studio (§2.21 Isolation, brand lain tombolnya 100% sama seperti
// sebelumnya - prop `brand` opsional, kalau tidak dikirim/bukan Agustap perilaku identik).
// "Inspiration: None" (default) = benchmark aktif tetap dipakai otomatis, sesuai §2.19
// "Kalau Inspiration = None: benchmark tetap digunakan."
export function AutoContentButton({ brandId, brand, onDone }: { brandId: string; brand?: Brand | null; onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const isAgustap = brand?.knowledgeSite === "agustap_studio";
  const [inspirationId, setInspirationId] = useState<string>("");

  const { data: inspirationsRaw } = useFetchedData<{ id: string; idea: string }[]>(
    async () => {
      if (!isAgustap) return [];
      const res = await fetch(`/api/brands/${brandId}/content-inspiration`);
      const data = await res.json();
      return (data.inspirations || []).filter((i: { used?: boolean }) => !i.used);
    },
    [brandId, isAgustap]
  );
  const inspirations = inspirationsRaw ?? [];

  async function handleClick() {
    setLoading(true);
    const res = await fetch(`/api/brands/${brandId}/auto-content`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isAgustap && inspirationId ? { agustapInspirationId: inspirationId } : {}),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      toast.error(data.error || "Gagal membuat konten otomatis");
      return;
    }
    toast.success(`Konten otomatis dibuat, cek di Draft: "${data.script}"`);
    setInspirationId("");
    onDone();
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {isAgustap && (
        <select
          value={inspirationId}
          onChange={(e) => setInspirationId(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm outline-none"
        >
          <option value="">Inspiration: None (benchmark tetap dipakai)</option>
          {inspirations.map((i) => (
            <option key={i.id} value={i.id}>
              {i.idea.slice(0, 50)}
            </option>
          ))}
        </select>
      )}
      <Button onClick={handleClick} disabled={loading}>
        {loading ? "Membuat konten..." : "⚡ Konten Otomatis"}
      </Button>
    </div>
  );
}
