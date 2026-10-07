"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { TOPUP_PACKS } from "@/lib/billing/topupPacks";

// Halaman kredit & top-up pelanggan (2026-09-30, T5). Lihat saldo, status langganan, tanggal
// berakhir, riwayat transaksi kredit; beli top-up saat kuota habis sebelum akhir bulan.

type Riwayat = { jumlah: number; alasan: string; saldoSetelah: number; createdAt: string };
type Kredit = {
  saldoKredit: number;
  status: string;
  periodeBerakhir: string | null;
  langgananDibatalkan: boolean;
  plan: { nama: string; kreditBulanan: number } | null;
  riwayat: Riwayat[];
};

const rupiah = (n: number) => "Rp " + n.toLocaleString("id-ID");
const tanggal = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—";

const STATUS_LANGGANAN: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  aktif: { label: "Aktif", variant: "default" },
  masa_tenggang: { label: "Masa tenggang", variant: "secondary" },
  terbatas: { label: "Terbatas (perpanjang paket)", variant: "destructive" },
};

export default function KreditPage() {
  const router = useRouter();
  const [data, setData] = useState<Kredit | null>(null);
  const [loading, setLoading] = useState(true);
  const [beli, setBeli] = useState<string | null>(null);
  const [aksi, setAksi] = useState(false);

  async function muat() {
    try {
      const d: Kredit = await fetch("/api/account/credits").then((r) => r.json());
      setData(d);
    } catch {
      toast.error("Gagal memuat data kredit");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { muat(); }, []);

  async function topup(packId: string) {
    setBeli(packId);
    try {
      const res = await fetch("/api/account/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error || "Gagal memproses top-up");
        return;
      }
      if (d.paymentUrl) {
        window.location.href = d.paymentUrl;
        return;
      }
      toast.success("Top-up dipilih. Menunggu konfirmasi pembayaran.");
    } catch {
      toast.error("Terjadi kesalahan. Coba lagi.");
    } finally {
      setBeli(null);
    }
  }

  async function ubahBatal(resume: boolean) {
    if (!resume && !confirm("Batalkan langganan? Akses TETAP sampai akhir periode, hanya tidak akan diperpanjang.")) return;
    setAksi(true);
    try {
      const res = await fetch("/api/account/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resume }) });
      if (!res.ok) throw new Error();
      await muat();
      toast.success(resume ? "Langganan dilanjutkan." : "Langganan dibatalkan - aktif sampai akhir periode.");
    } catch {
      toast.error("Gagal memproses. Coba lagi.");
    } finally {
      setAksi(false);
    }
  }

  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <p className="text-sm text-muted-foreground">Memuat kredit…</p>
      </div>
    );
  }

  const st = STATUS_LANGGANAN[data.status] ?? { label: data.status, variant: "secondary" as const };

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-2xl font-heading font-bold">Kredit & Langganan</h1>
          <Button variant="outline" onClick={() => router.push("/")}>Ke dashboard</Button>
        </div>

        {/* Ringkasan saldo */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="sm:col-span-1">
            <CardContent className="pt-6">
              <div className="text-4xl font-bold tabular-nums">{data.saldoKredit}</div>
              <div className="text-xs text-muted-foreground mt-1">sisa kredit</div>
            </CardContent>
          </Card>
          <Card className="sm:col-span-2">
            <CardContent className="pt-6 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="text-sm text-muted-foreground">Paket</div>
                <div className="font-semibold capitalize">{data.plan?.nama ?? "Belum ada paket"}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Status</div>
                <Badge variant={st.variant}>{st.label}</Badge>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Berlaku sampai</div>
                <div className="font-semibold">{tanggal(data.periodeBerakhir)}</div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Aksi langganan (#1 perpanjang, #2 batalkan) */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={() => router.push("/pilih-paket")}>Perpanjang langganan</Button>
          {data.langgananDibatalkan ? (
            <>
              <span className="text-xs text-muted-foreground">Langganan dibatalkan - akses sampai {tanggal(data.periodeBerakhir)}.</span>
              <Button variant="outline" disabled={aksi} onClick={() => ubahBatal(true)}>Lanjutkan langganan</Button>
            </>
          ) : (
            <Button variant="outline" disabled={aksi} onClick={() => ubahBatal(false)}>Batalkan langganan</Button>
          )}
        </div>

        {/* Top-up */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Top-up kredit
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {TOPUP_PACKS.map((p) => (
              <Card key={p.id}>
                <CardHeader>
                  <CardTitle className="text-lg font-heading">{p.nama}</CardTitle>
                  <div className="text-2xl font-bold mt-1">{rupiah(p.hargaIdr)}</div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground mb-3">+{p.kredit} kredit langsung masuk.</p>
                  <Button className="w-full" variant="outline" disabled={beli !== null} onClick={() => topup(p.id)}>
                    {beli === p.id ? "Memproses…" : "Beli"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Riwayat */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Riwayat kredit (20 terakhir)
          </h2>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Keterangan</TableHead>
                      <TableHead className="text-right">Jumlah</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.riwayat.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm">{tanggal(r.createdAt)}</TableCell>
                        <TableCell className="text-sm">{r.alasan}</TableCell>
                        <TableCell className={`text-right tabular-nums ${r.jumlah < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>
                          {r.jumlah > 0 ? `+${r.jumlah}` : r.jumlah}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.saldoSetelah}</TableCell>
                      </TableRow>
                    ))}
                    {data.riwayat.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                          Belum ada transaksi kredit.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
