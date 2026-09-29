"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// Halaman balik setelah bayar (2026-09-30, T4). Duitku redirect ke sini (returnUrl). Aktivasi
// paket terjadi via WEBHOOK (async) - jadi halaman ini POLL GET /api/account/credits beberapa
// kali sampai paket muncul aktif. Kalau belum aktif setelah beberapa detik (webhook telat/
// pembayaran belum tuntas), tampilkan status "menunggu" - bukan gagal.

type Kredit = {
  saldoKredit: number;
  plan: { nama: string; kreditBulanan: number } | null;
};

export default function SuksesPage() {
  const router = useRouter();
  const [data, setData] = useState<Kredit | null>(null);
  const [selesai, setSelesai] = useState(false);

  useEffect(() => {
    let batal = false;
    let coba = 0;
    async function cek() {
      coba++;
      try {
        const d: Kredit = await fetch("/api/account/credits").then((r) => r.json());
        if (batal) return;
        setData(d);
        if (d.plan) {
          setSelesai(true);
          return; // paket sudah aktif
        }
      } catch { /* abaikan, coba lagi */ }
      if (coba < 6 && !batal) {
        setTimeout(cek, 2500); // poll ~6x selama ~15 detik
      } else {
        setSelesai(true);
      }
    }
    cek();
    return () => { batal = true; };
  }, []);

  const aktif = !!data?.plan;

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="text-5xl mb-2">{!selesai ? "⏳" : aktif ? "✅" : "🕐"}</div>
          <CardTitle className="font-heading">
            {!selesai ? "Mengecek pembayaran…" : aktif ? "Pembayaran berhasil!" : "Menunggu konfirmasi"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {aktif ? (
            <p className="text-sm text-muted-foreground">
              Paket <span className="font-semibold capitalize text-foreground">{data!.plan!.nama}</span> aktif.
              Saldo kamu <span className="font-semibold text-foreground">{data!.saldoKredit} kredit</span>.
              Selamat membuat konten!
            </p>
          ) : selesai ? (
            <p className="text-sm text-muted-foreground">
              Pembayaran kamu sedang diproses. Kalau sudah bayar, paket akan aktif otomatis dalam
              beberapa menit. Muat ulang halaman ini atau cek dashboard nanti.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Sebentar ya…</p>
          )}
          <Button className="w-full" onClick={() => { router.push(aktif ? "/onboarding" : "/"); router.refresh(); }}>
            {aktif ? "Lanjut: setup akun" : "Ke dashboard"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
