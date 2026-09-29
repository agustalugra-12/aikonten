"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

// Halaman pilih paket + checkout (2026-09-30, T4). Ditampilkan setelah signup (atau dari
// banner dashboard kalau user belum punya paket). Ambil daftar paket dari GET /api/plans,
// tombol "Pilih" -> POST /api/account/select-plan -> kalau ada paymentUrl (Duitku), redirect
// ke situ; kalau belum ada gateway (dev), tampilkan status menunggu konfirmasi manual.
// Butuh login (proxy.ts sudah menjamin - /pilih-paket bukan public path).

type Plan = {
  id: string; nama: string; kreditBulanan: number; hargaBulananIdr: number;
  izinAutoPosting: boolean; maxBrand: number;
};

const rupiah = (n: number) => "Rp " + n.toLocaleString("id-ID");

export default function PilihPaketPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [prosesId, setProsesId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/plans")
      .then((r) => r.json())
      .then((rows: Plan[]) => setPlans([...rows].sort((a, b) => a.hargaBulananIdr - b.hargaBulananIdr)))
      .catch(() => toast.error("Gagal memuat daftar paket"))
      .finally(() => setLoading(false));
  }, []);

  async function pilih(plan: Plan) {
    setProsesId(plan.id);
    try {
      const res = await fetch("/api/account/select-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Gagal memproses pilihan paket");
        return;
      }
      if (data.paymentUrl) {
        // Redirect ke halaman bayar Duitku.
        window.location.href = data.paymentUrl;
        return;
      }
      // Gateway belum aktif (dev/staging) - tagihan pending, aktivasi manual admin.
      toast.success("Paket dipilih. Menunggu konfirmasi pembayaran.");
      router.push(`/pilih-paket/sukses?bill=${data.billingLogId}`);
    } catch {
      toast.error("Terjadi kesalahan. Coba lagi.");
    } finally {
      setProsesId(null);
    }
  }

  return (
    <div className="min-h-screen bg-muted/30 py-12 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-heading font-bold">Pilih paket kamu</h1>
          <p className="text-muted-foreground mt-2">
            Setiap konten (foto/video/carousel) = 1 kredit. Bisa upgrade kapan saja.
          </p>
        </div>

        {loading ? (
          <p className="text-center text-sm text-muted-foreground">Memuat paket…</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {plans.map((p, i) => {
              const populer = p.nama === "pro";
              return (
                <Card key={p.id} className={populer ? "border-primary shadow-lg relative" : ""}>
                  {populer && (
                    <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2">Paling populer</Badge>
                  )}
                  <CardHeader>
                    <CardTitle className="capitalize font-heading text-xl">{p.nama}</CardTitle>
                    <div className="mt-2">
                      <span className="text-3xl font-bold">{rupiah(p.hargaBulananIdr)}</span>
                      <span className="text-sm text-muted-foreground">/bulan</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ul className="text-sm space-y-2">
                      <li>✓ {p.kreditBulanan} konten / bulan</li>
                      <li>✓ {p.izinAutoPosting ? "Auto-posting ke sosial media" : "Download konten (tanpa auto-posting)"}</li>
                      <li>✓ {p.maxBrand} brand</li>
                      <li>✓ Analitik & laporan performa</li>
                    </ul>
                    <Button
                      className="w-full"
                      variant={populer ? "default" : "outline"}
                      disabled={prosesId !== null}
                      onClick={() => pilih(p)}
                    >
                      {prosesId === p.id ? "Memproses…" : "Pilih paket ini"}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground mt-8">
          Pembayaran aman via Duitku (QRIS / Virtual Account / e-wallet).
        </p>
      </div>
    </div>
  );
}
