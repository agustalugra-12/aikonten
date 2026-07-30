"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

// "Research Engine" ringan (lihat memory proyek - keputusan Agus: pakai pengetahuan
// GPT, bukan API tren berbayar). Klik salah satu ide -> langsung buka "Konten Baru"
// dgn skrip ter-isi (lihat onPickIdea di page.tsx).
export function ContentIdeas({ brandId, onPickIdea }: { brandId: string; onPickIdea: (script: string) => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ideas, setIdeas] = useState<string[] | null>(null);

  async function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && ideas === null) {
      setLoading(true);
      const res = await fetch(`/api/brands/${brandId}/content-ideas`);
      const data = await res.json();
      setLoading(false);
      if (!res.ok) {
        toast.error(data.error || "Gagal ambil ide konten");
        setIdeas([]);
        return;
      }
      setIdeas(data.ideas);
    }
  }

  function handlePick(idea: string) {
    onPickIdea(idea);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline">💡 Ide Konten</Button>} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ide Konten</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {loading ? (
            <p className="text-sm text-muted-foreground">Memikirkan ide...</p>
          ) : !ideas || ideas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada ide - coba lagi nanti.</p>
          ) : (
            <ul className="space-y-2">
              {ideas.map((idea, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => handlePick(idea)}
                    className="w-full text-left text-sm rounded-md border p-3 hover:bg-muted transition-colors"
                  >
                    {idea}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
