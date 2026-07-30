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

// Platform yg didukung app ini (harus sinkron dgn SUPPORTED_BUFFER_PLATFORMS di route
// POST /api/brands/[id]/social-accounts) - Buffer sendiri support platform lain juga
// (LinkedIn, X, dst) yg TIDAK kita model di schema, jadi difilter di sini biar Agus
// tidak coba sambungkan channel yg nanti bakal gagal.
const SUPPORTED_SERVICES = new Set(["instagram", "facebook", "tiktok", "youtube"]);

// Beda dari YouTube/Meta (redirect OAuth penuh halaman) - Buffer cuma perlu Agus MEMILIH
// salah satu channel yg sudah dia sambungkan sendiri di dashboard Buffer, jadi ini
// dialog biasa (fetch client-side), bukan redirect. Dipakai utk platform APA SAJA yg
// Agus hubungkan lewat Buffer (awalnya TikTok, sekarang juga Instagram selagi uji coba
// gratis Buffer - lihat memory proyek).
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
      body: JSON.stringify({ bufferChannelId: channel.id, username: channel.name, platform: channel.service }),
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

  const supportedChannels = channels?.filter((ch) => SUPPORTED_SERVICES.has(ch.service));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm">+ Sambungkan via Buffer</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pilih Channel Buffer</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {loading && <p className="text-sm text-muted-foreground">Memuat channel...</p>}
          {!loading && supportedChannels?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Belum ada channel yang didukung tersambung di Buffer. Sambungkan dulu
              channel-nya (Instagram/TikTok/Facebook/YouTube) di dashboard Buffer, lalu
              coba lagi.
            </p>
          )}
          {supportedChannels?.map((ch) => (
            <div key={ch.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">{ch.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{ch.service}</p>
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
