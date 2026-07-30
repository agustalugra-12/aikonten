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
import type { BufferChannel } from "@/lib/publish/bufferAuth";

// Beda dari YouTube/Meta (redirect OAuth penuh halaman) - Buffer cuma perlu Agus MEMILIH
// salah satu channel yg sudah dia sambungkan sendiri di dashboard Buffer, jadi ini
// dialog biasa (fetch client-side), bukan redirect.
export function ConnectBufferDialog({ brandId, onConnected }: { brandId: string; onConnected: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [channels, setChannels] = useState<BufferChannel[] | null>(null);
  const [attaching, setAttaching] = useState<string | null>(null);

  async function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && channels === null) {
      setLoading(true);
      const res = await fetch("/api/auth/buffer/channels");
      const data = await res.json();
      setLoading(false);
      if (!res.ok) {
        toast.error(data.error || "Gagal ambil daftar channel Buffer");
        setChannels([]);
        return;
      }
      setChannels(data);
    }
  }

  async function handleAttach(channel: BufferChannel) {
    setAttaching(channel.id);
    const res = await fetch(`/api/brands/${brandId}/social-accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bufferChannelId: channel.id, username: channel.name }),
    });
    setAttaching(null);
    if (res.ok) {
      toast.success(`${channel.name} tersambung ke brand ini`);
      setOpen(false);
      onConnected();
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || "Gagal menyambungkan channel");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm">+ Sambungkan TikTok (via Buffer)</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pilih Channel Buffer</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {loading && <p className="text-sm text-muted-foreground">Memuat channel...</p>}
          {!loading && channels?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Belum ada channel tersambung di Buffer. Sambungkan dulu channel TikTok-nya di
              dashboard Buffer, lalu coba lagi.
            </p>
          )}
          {channels?.map((ch) => (
            <div key={ch.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">{ch.name}</p>
                <p className="text-xs text-muted-foreground">{ch.service}</p>
              </div>
              <Button size="sm" disabled={attaching === ch.id} onClick={() => handleAttach(ch)}>
                {attaching === ch.id ? "Menyambungkan..." : "Sambungkan"}
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
