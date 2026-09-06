"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  // Token Buffer per-brand (2026-08-06, permintaan Agus - brand yg akun Buffer-nya
  // TERPISAH dari akun default/bersama, mis. "laundry in bali") - kosong = pakai akun
  // Buffer default (BUFFER_ACCESS_TOKEN di .env, perilaku lama).
  const [customToken, setCustomToken] = useState("");

  async function handleLoadChannels() {
    setLoading(true);
    // try/catch (2026-09-06, bug nyata ditemukan - laporan Agus "klik Muat Channel,
    // tidak ada respons sama sekali") - SEBELUM ini TIDAK ADA try/catch di sini sama
    // sekali. Kalau fetch gagal (network error) ATAU res.json() gagal parse (server
    // balikin HTML/non-JSON, mis. error 502/504 dari upstream), exception ini TIDAK
    // TERTANGKAP - loading tetap true selamanya (macet diam-diam), TIDAK ADA toast
    // error, persis simptom yg dilaporkan. Sekarang exception apa pun ditangkap &
    // ditampilkan sbg toast, loading SELALU direset di finally.
    try {
      const url = customToken.trim()
        ? `/api/auth/buffer/channels?token=${encodeURIComponent(customToken.trim())}`
        : "/api/auth/buffer/channels";
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Gagal ambil daftar channel Buffer");
        setChannels([]);
        return;
      }
      setChannels(data);
    } catch (err) {
      console.error("[ConnectBufferDialog] gagal muat channel:", err);
      toast.error(err instanceof Error ? `Gagal muat channel: ${err.message}` : "Gagal muat channel (error tidak diketahui)");
      setChannels([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && channels === null && !customToken) {
      await handleLoadChannels();
    }
  }

  async function handleAttach(channel: BufferChannel) {
    setAttaching(channel.id);
    // try/catch + finally (2026-09-06, pola bug sama dgn handleLoadChannels di atas) -
    // network error di sini SEBELUMNYA jg tidak tertangkap, attaching bisa macet true
    // selamanya (tombol "Menyambungkan..." tidak pernah kembali normal) tanpa toast.
    try {
      const res = await fetch(`/api/brands/${brandId}/social-accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bufferChannelId: channel.id,
          username: channel.name,
          platform: channel.service,
          bufferAccessToken: customToken.trim() || null,
        }),
      });
      if (res.ok) {
        toast.success(`${channel.name} tersambung ke brand ini`);
        setOpen(false);
        onConnected();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Gagal menyambungkan channel");
      }
    } catch (err) {
      console.error("[ConnectBufferDialog] gagal menyambungkan channel:", err);
      toast.error(err instanceof Error ? `Gagal menyambungkan: ${err.message}` : "Gagal menyambungkan channel (error tidak diketahui)");
    } finally {
      setAttaching(null);
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
          <div className="space-y-1">
            <Label htmlFor="bufferToken" className="text-xs">
              Token Buffer (opsional - kosongkan utk pakai akun Buffer default)
            </Label>
            <div className="flex gap-2">
              <Input
                id="bufferToken"
                type="password"
                placeholder="Isi kalau brand ini punya akun Buffer sendiri, beda dari default"
                value={customToken}
                onChange={(e) => {
                  setCustomToken(e.target.value);
                  setChannels(null);
                }}
                className="flex-1"
              />
              <Button size="sm" variant="outline" onClick={handleLoadChannels} disabled={loading}>
                Muat Channel
              </Button>
            </div>
          </div>
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
