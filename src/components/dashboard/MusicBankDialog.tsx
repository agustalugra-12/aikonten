"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

type MoodValue = "calm" | "mysterious" | "upbeat" | "dramatic" | "neutral";

const MOOD_LABELS: Record<MoodValue, string> = {
  calm: "Santai/Tenang",
  mysterious: "Misterius",
  upbeat: "Semangat/Ceria",
  dramatic: "Dramatis/Intens",
  neutral: "Netral",
};

type Track = {
  id: string;
  fileUrl: string;
  title: string;
  mood: MoodValue;
  durationSeconds: number;
};

function previewUrl(fileUrl: string): string {
  return `/api/media-proxy?url=${encodeURIComponent(fileUrl)}`;
}

// Music Bank (2026-08-10, PRD "AI Content Editing Engine") - Pexels/Pixabay TIDAK PUNYA
// API musik (dicek langsung ke docs resmi keduanya), jadi BEDA dari Bank Footage yg
// auto-dianalisis AI - musik SELALU upload manual Agus, title+mood diisi manual saat
// upload (mood musik itu penilaian subjektif). AI Director (aiDirector.ts) pilih dari
// track2 di sini berdasar mood scene, bukan search API eksternal.
export function MusicBankDialog({ brandId }: { brandId: string }) {
  const [open, setOpen] = useState(false);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [mood, setMood] = useState<MoodValue>("neutral");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function loadTracks() {
    const res = await fetch(`/api/brands/${brandId}/music-bank`);
    if (res.ok) setTracks(await res.json());
  }

  async function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && tracks === null) await loadTracks();
  }

  function handleFileSelect(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setPendingFile(file);
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
  }

  async function handleUpload() {
    if (!pendingFile || !title.trim()) {
      toast.error("Pilih file & isi judul dulu");
      return;
    }
    setUploading(true);
    try {
      const presignRes = await fetch(`/api/brands/${brandId}/music-bank/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: pendingFile.name, contentType: pendingFile.type }),
      });
      if (!presignRes.ok) throw new Error((await presignRes.json()).error || "Gagal menyiapkan upload");
      const { uploadUrl, publicUrl } = await presignRes.json();

      const putRes = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": pendingFile.type }, body: pendingFile });
      if (!putRes.ok) throw new Error("Gagal upload file musik");

      const regRes = await fetch(`/api/brands/${brandId}/music-bank`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileUrl: publicUrl, title: title.trim(), mood }),
      });
      if (!regRes.ok) throw new Error((await regRes.json()).error || "Gagal mendaftarkan track");

      toast.success(`"${title}" ditambahkan ke Music Bank`);
      setPendingFile(null);
      setTitle("");
      setMood("neutral");
      await loadTracks();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal upload musik");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(trackId: string) {
    if (!confirm("Hapus track ini dari Music Bank?")) return;
    setDeletingId(trackId);
    try {
      const res = await fetch(`/api/brands/${brandId}/music-bank/${trackId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Gagal menghapus track");
      setTracks((prev) => (prev ? prev.filter((t) => t.id !== trackId) : prev));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus track");
    } finally {
      setDeletingId(null);
    }
  }

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline">🎵 Music Bank</Button>} />
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Music Bank</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Upload musik latar royalty-free (pastikan lisensinya aman dipakai komersial). AI Director
            pilih otomatis dari sini sesuai mood tiap adegan video - tidak ada pencarian musik eksternal
            (Pexels/Pixabay tidak punya API musik).
          </p>

          <div className="space-y-2 rounded-md border p-3">
            <Input type="file" accept="audio/*" onChange={(e) => handleFileSelect(e.target.files)} disabled={uploading} />
            {pendingFile && (
              <>
                <Input
                  placeholder="Judul track..."
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={uploading}
                />
                <Select value={mood} onValueChange={(v) => setMood((v as MoodValue) || "neutral")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(MOOD_LABELS) as MoodValue[]).map((m) => (
                      <SelectItem key={m} value={m}>
                        {MOOD_LABELS[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={handleUpload} disabled={uploading} className="w-full">
                  {uploading ? "Mengunggah..." : "Tambah ke Music Bank"}
                </Button>
              </>
            )}
          </div>

          {tracks === null ? (
            <p className="text-sm text-muted-foreground">Memuat...</p>
          ) : tracks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada musik. Upload beberapa track dengan mood berbeda (santai, misterius, semangat,
              dramatis) supaya AI Director punya pilihan sesuai isi tiap video.
            </p>
          ) : (
            <div className="space-y-2">
              {tracks.map((track) => (
                <div key={track.id} className="flex items-center gap-2 rounded-md border p-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{track.title}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge variant="secondary" className="text-xs">{MOOD_LABELS[track.mood]}</Badge>
                      <span className="text-xs text-muted-foreground">{formatDuration(track.durationSeconds)}</span>
                    </div>
                  </div>
                  <audio src={previewUrl(track.fileUrl)} controls className="h-8 max-w-[180px]" preload="none" />
                  <button
                    type="button"
                    onClick={() => handleDelete(track.id)}
                    disabled={deletingId === track.id}
                    aria-label={`Hapus ${track.title}`}
                    className="h-6 w-6 rounded-full bg-muted text-muted-foreground text-xs flex items-center justify-center hover:bg-destructive hover:text-white transition-colors shrink-0"
                  >
                    {deletingId === track.id ? "…" : "×"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
