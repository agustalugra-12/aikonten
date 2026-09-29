"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

// Onboarding pasca-bayar (2026-09-30, T7). Setelah paket aktif tapi belum ada brand,
// tuntun: (1) buat brand pertama (POST /api/brands), (2) utk paket auto-posting, arahkan
// ke UI connect Buffer yang SUDAH ADA di dashboard (menu Kanal) - pelanggan daftar Buffer
// sendiri lalu hubungkan. Starter (tanpa auto-posting) lewati Buffer, jelaskan download.
// Merangkai alur pakai endpoint & halaman yang ada - tidak membangun ulang komponen.

type Plan = { nama: string; izinAutoPosting: boolean } | null;

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<Plan>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [nama, setNama] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [acc, brands] = await Promise.all([
          fetch("/api/account/credits").then((r) => r.json()),
          fetch("/api/brands").then((r) => r.json()),
        ]);
        if (!acc?.plan) { router.replace("/pilih-paket"); return; } // belum bayar
        if (Array.isArray(brands) && brands.length > 0) { router.replace("/"); return; } // sudah setup
        setPlan(acc.plan);
      } catch {
        toast.error("Gagal memuat data akun");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function buatBrand(e: React.FormEvent) {
    e.preventDefault();
    if (!nama.trim()) return;
    setBusy(true);
    const res = await fetch("/api/brands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nama.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error || "Gagal membuat brand");
      return;
    }
    toast.success("Brand pertama kamu dibuat!");
    if (plan?.izinAutoPosting) {
      setStep(2); // paket auto-posting -> tuntun connect Buffer
    } else {
      router.push("/"); // Starter -> langsung ke dashboard
      router.refresh();
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <p className="text-sm text-muted-foreground">Menyiapkan akun kamu…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">
            Langkah {step} dari {plan?.izinAutoPosting ? 2 : 1}
          </div>
          <CardTitle className="font-heading">
            {step === 1 ? "Buat brand pertama kamu" : "Sambungkan akun sosial media"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 1 ? (
            <form onSubmit={buatBrand} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Brand = bisnis/akun yang kontennya akan kamu buat. Bisa tambah brand lain nanti
                sesuai paket.
              </p>
              <div className="space-y-2">
                <Label htmlFor="nama">Nama brand</Label>
                <Input
                  id="nama" value={nama} onChange={(e) => setNama(e.target.value)}
                  autoFocus required placeholder="mis. Kopi Senja"
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Membuat…" : "Buat brand & lanjut"}
              </Button>
            </form>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Paket <span className="font-semibold capitalize text-foreground">{plan?.nama}</span> kamu
                bisa <span className="font-semibold text-foreground">auto-posting</span> ke sosial media.
                Daftar akun <span className="font-semibold text-foreground">Buffer</span> (gratis) lalu
                sambungkan kanal (Instagram/TikTok/dll) di menu <span className="font-semibold text-foreground">Kanal</span> di dashboard.
              </p>
              <p className="text-xs text-muted-foreground">
                Kalau mau nanti saja, kamu tetap bisa membuat & mengunduh konten dulu; auto-posting
                aktif setelah Buffer tersambung.
              </p>
              <div className="flex gap-2">
                <Button className="flex-1" onClick={() => { router.push("/"); router.refresh(); }}>
                  Ke dashboard (sambungkan Buffer)
                </Button>
              </div>
              <Button variant="ghost" className="w-full" onClick={() => { router.push("/"); router.refresh(); }}>
                Nanti saja
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
