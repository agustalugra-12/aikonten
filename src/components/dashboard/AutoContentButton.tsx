"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// "⚡ Konten Otomatis" (lihat memory proyek - "otomatis seperti AI blog") - SATU klik,
// tanpa dialog/input apa pun: server sendiri yg usul ide (kalau perlu), cocokkan ke
// Footage Bank, proses, & publish. Lihat /api/brands/[id]/auto-content.
export function AutoContentButton({ brandId, onDone }: { brandId: string; onDone: () => void }) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    const res = await fetch(`/api/brands/${brandId}/auto-content`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      toast.error(data.error || "Gagal membuat konten otomatis");
      return;
    }
    toast.success(`Konten otomatis dibuat, cek di Draft: "${data.script}"`);
    onDone();
  }

  return (
    <Button onClick={handleClick} disabled={loading}>
      {loading ? "Membuat konten..." : "⚡ Konten Otomatis"}
    </Button>
  );
}
