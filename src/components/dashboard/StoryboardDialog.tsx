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
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

type StoryboardScene = {
  sceneNumber: number;
  durationSeconds: number;
  visualDescription: string;
  cameraNotes: string;
  narrationLine: string;
};
type Storyboard = { id: string; script: string; scenes: StoryboardScene[]; createdAt: string };

function SceneList({ scenes }: { scenes: StoryboardScene[] }) {
  return (
    <ol className="space-y-3">
      {scenes.map((s) => (
        <li key={s.sceneNumber} className="rounded-md border p-3 space-y-1">
          <p className="text-sm font-medium">
            Scene {s.sceneNumber} <span className="text-muted-foreground font-normal">({s.durationSeconds}s)</span>
          </p>
          <p className="text-sm">{s.visualDescription}</p>
          <p className="text-xs text-muted-foreground">📷 {s.cameraNotes}</p>
          {s.narrationLine && <p className="text-xs italic text-muted-foreground">&quot;{s.narrationLine}&quot;</p>}
        </li>
      ))}
    </ol>
  );
}

// "Storyboard Engine" - shot list PRA-produksi (lihat memory proyek). Berdiri sendiri
// dari alur upload/process - Agus baca ini SEBELUM syuting, baru upload footage asli
// spt biasa lewat "+ Konten Baru".
export function StoryboardDialog({ brandId }: { brandId: string }) {
  const [open, setOpen] = useState(false);
  const [script, setScript] = useState("");
  const [generating, setGenerating] = useState(false);
  const [history, setHistory] = useState<Storyboard[] | null>(null);
  const [latest, setLatest] = useState<Storyboard | null>(null);

  async function loadHistory() {
    const res = await fetch(`/api/brands/${brandId}/storyboards`);
    if (res.ok) setHistory(await res.json());
  }

  async function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && history === null) await loadHistory();
  }

  async function handleGenerate() {
    if (!script.trim()) return;
    setGenerating(true);
    const res = await fetch(`/api/brands/${brandId}/storyboards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script }),
    });
    const data = await res.json();
    setGenerating(false);
    if (!res.ok) {
      toast.error(data.error || "Gagal bikin storyboard");
      return;
    }
    setLatest(data);
    setScript("");
    await loadHistory();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline">🎬 Storyboard</Button>} />
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Storyboard (Panduan Sebelum Syuting)</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <textarea
              className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs"
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="Topik/brief video yang mau dibuatkan storyboard-nya"
            />
            <Button onClick={handleGenerate} disabled={generating || !script.trim()}>
              {generating ? "Membuat storyboard..." : "Buat Storyboard"}
            </Button>
          </div>

          {latest && (
            <>
              <Separator />
              <div>
                <p className="text-sm font-medium mb-2">{latest.script}</p>
                <SceneList scenes={latest.scenes} />
              </div>
            </>
          )}

          {history && history.length > 0 && (
            <>
              <Separator />
              <p className="text-sm font-medium">Riwayat storyboard</p>
              <div className="space-y-4">
                {history
                  .filter((h) => h.id !== latest?.id)
                  .map((h) => (
                    <div key={h.id} className="space-y-2">
                      <p className="text-sm text-muted-foreground">{h.script}</p>
                      <SceneList scenes={h.scenes} />
                    </div>
                  ))}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
