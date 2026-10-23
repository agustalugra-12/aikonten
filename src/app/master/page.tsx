"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import KreditAICard from "@/components/master/KreditAICard";

// Master Dashboard (2026-09-30, permintaan Agus) - satu-satunya halaman lintas-pelanggan,
// khusus admin (ADMIN_EMAILS). Memantau jumlah pelanggan per paket, status langganan
// (aktif/masa tenggang/terbatas - T6), siapa yang disuspend admin, detail tiap pelanggan.
// Proteksi: /api/master/* menolak non-admin (403); kalau 403 halaman tampilkan pesan tegas.

type StatusKategori = "berlangganan" | "masa_tenggang" | "terbatas" | "tanpa_paket" | "diblokir";

type Plan = {
  id: string; nama: string; kreditBulanan: number; hargaBulananIdr: number;
  izinAutoPosting: boolean; maxBrand: number;
};
type Pelanggan = {
  id: string; email: string; namaBisnis: string | null; nama: string | null; nomorWa: string | null; langgananDibatalkan: boolean;
  status: StatusKategori;
  statusLangganan: string; diblokirAdmin: boolean; saldoKredit: number; jumlahBrand: number;
  plan: Plan | null;
  periodeMulai: string | null; periodeBerakhir: string | null; createdAt: string;
};
type PerPaket = {
  id: string; nama: string; hargaBulananIdr: number; kreditBulanan: number;
  izinAutoPosting: boolean; maxBrand: number; aktif: boolean; jumlahPelangganAktif: number;
};
type Overview = {
  ringkasan: {
    totalPelanggan: number; berlangganan: number; masaTenggang: number; terbatas: number;
    tanpaPaket: number; diblokir: number; mrrIdr: number; totalSaldoKredit: number;
  };
  perPaket: PerPaket[];
  pelanggan: Pelanggan[];
};

const rupiah = (n: number) => "Rp " + n.toLocaleString("id-ID");
const tanggal = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—";

const STATUS_LABEL: Record<StatusKategori, string> = {
  berlangganan: "Berlangganan",
  masa_tenggang: "Masa tenggang",
  terbatas: "Terbatas",
  tanpa_paket: "Tanpa paket",
  diblokir: "Diblokir",
};
const STATUS_VARIANT: Record<StatusKategori, "default" | "secondary" | "destructive" | "outline"> = {
  berlangganan: "default",
  masa_tenggang: "secondary",
  terbatas: "destructive",
  tanpa_paket: "outline",
  diblokir: "destructive",
};
const FILTER_ORDER: StatusKategori[] = ["berlangganan", "masa_tenggang", "terbatas", "tanpa_paket", "diblokir"];

export default function MasterPage() {
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [filter, setFilter] = useState<"semua" | StatusKategori>("semua");
  const [cari, setCari] = useState("");

  async function muat() {
    setLoading(true);
    const res = await fetch("/api/master/overview");
    if (res.status === 403) {
      setForbidden(true);
      setLoading(false);
      return;
    }
    if (res.ok) {
      setData(await res.json());
    }
    setLoading(false);
  }

  useEffect(() => {
    muat();
  }, []);

  const pelangganTampil = useMemo(() => {
    if (!data) return [];
    let list = data.pelanggan;
    if (filter !== "semua") list = list.filter((p) => p.status === filter);
    if (cari.trim()) {
      const q = cari.trim().toLowerCase();
      list = list.filter(
        (p) => p.email.toLowerCase().includes(q) || (p.namaBisnis ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [data, filter, cari]);

  if (forbidden) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Akses ditolak</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              Halaman ini khusus admin. Akun yang sedang login tidak terdaftar sebagai admin
              (lihat <code className="text-foreground">ADMIN_EMAILS</code> di konfigurasi server).
            </p>
            <Button variant="outline" onClick={() => router.push("/")}>Kembali ke dashboard</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <p className="text-sm text-muted-foreground">Memuat data pelanggan…</p>
      </div>
    );
  }

  const r = data.ringkasan;

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-heading font-bold">Master Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Pantau semua pelanggan, paket, dan status langganan.
            </p>
          </div>
          <Button variant="outline" onClick={() => router.push("/")}>Ke dashboard konten</Button>
        </div>

        {/* Kartu ringkasan */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <StatCard label="Total pelanggan" value={r.totalPelanggan} />
          <StatCard label="Berlangganan" value={r.berlangganan} tone="good" />
          <StatCard label="Masa tenggang" value={r.masaTenggang} tone="muted" />
          <StatCard label="Terbatas" value={r.terbatas} tone="bad" />
          <StatCard label="Tanpa paket" value={r.tanpaPaket} tone="muted" />
          <StatCard label="Diblokir" value={r.diblokir} tone="bad" />
          <StatCard label="MRR berjalan" value={rupiah(r.mrrIdr)} small />
        </div>

        <KreditAICard />

        {/* Breakdown per paket */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Pelanggan aktif per paket
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.perPaket.map((p) => (
              <Card key={p.id}>
                <CardContent className="pt-5">
                  <div className="flex items-baseline justify-between">
                    <span className="font-heading font-semibold capitalize">{p.nama}</span>
                    {!p.aktif && <Badge variant="outline">nonaktif</Badge>}
                  </div>
                  <div className="text-3xl font-bold mt-2">{p.jumlahPelangganAktif}</div>
                  <div className="text-xs text-muted-foreground mt-1">pelanggan aktif</div>
                  <div className="mt-3 pt-3 border-t text-xs text-muted-foreground space-y-1">
                    <div>{rupiah(p.hargaBulananIdr)}/bln · {p.kreditBulanan} kredit</div>
                    <div>
                      {p.izinAutoPosting ? "Auto-posting ✓" : "Download only"} · maks {p.maxBrand} brand
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {data.perPaket.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Belum ada paket. Jalankan seed plans di server.
              </p>
            )}
          </div>
        </div>

        {/* Filter + pencarian */}
        <div className="flex items-center gap-2 flex-wrap">
          {(["semua", ...FILTER_ORDER] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              onClick={() => setFilter(f)}
            >
              {f === "semua" ? "Semua" : STATUS_LABEL[f]}
            </Button>
          ))}
          <div className="flex-1 min-w-[200px]">
            <Input
              placeholder="Cari email atau nama bisnis…"
              value={cari}
              onChange={(e) => setCari(e.target.value)}
            />
          </div>
        </div>

        <PendingPaymentsCard onDone={muat} />

        {/* Tabel pelanggan */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pelanggan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Paket</TableHead>
                    <TableHead className="text-right">Kredit</TableHead>
                    <TableHead className="text-right">Brand</TableHead>
                    <TableHead>Berakhir</TableHead>
                    <TableHead>Daftar</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pelangganTampil.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div className="font-medium">{p.namaBisnis || p.nama || "—"}</div>
                        <div className="text-xs text-muted-foreground">{p.email}</div>
                        {(p.nama || p.nomorWa) && <div className="text-xs text-muted-foreground">{[p.nama, p.nomorWa ? "WA " + p.nomorWa : null].filter(Boolean).join(" · ")}</div>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                      </TableCell>
                      <TableCell className="capitalize">
                        {p.plan ? p.plan.nama : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{p.saldoKredit}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.jumlahBrand}</TableCell>
                      <TableCell className="text-sm">{tanggal(p.periodeBerakhir)}</TableCell>
                      <TableCell className="text-sm">{tanggal(p.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <AksiPelanggan p={p} onDone={muat} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {pelangganTampil.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                        Tidak ada pelanggan yang cocok.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <AuditLogCard />
        <Keamanan2FACard />
      </div>
    </div>
  );
}

function AuditLogCard() {
  const [entries, setEntries] = useState<Array<{ id: string; adminEmail: string; aksi: string; targetEmail: string | null; detail: string | null; createdAt: number }>>([]);
  const [buka, setBuka] = useState(false);
  useEffect(() => {
    if (!buka) return;
    fetch("/api/master/audit-log").then((r) => r.json()).then((d) => setEntries(d.entries || [])).catch(() => {});
  }, [buka]);
  const AKSI: Record<string, string> = {
    konfirmasi_bayar: "Konfirmasi bayar", tambah_kredit: "Tambah kredit", reset_password: "Reset password",
    suspend: "Suspend akun", aktifkan: "Aktifkan akun", batal_paket: "Batalkan paket", lanjut_paket: "Lanjutkan paket",
    hapus_data: "Hapus data", export_data: "Export data",
  };
  const waktu = (t: number) => new Date(t * 1000).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={() => setBuka((v) => !v)}>
        <CardTitle className="text-base">Log aktivitas admin {buka ? "\u25B2" : "\u25BC"}</CardTitle>
      </CardHeader>
      {buka && (
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Waktu</TableHead><TableHead>Admin</TableHead><TableHead>Aksi</TableHead>
                <TableHead>Target</TableHead><TableHead>Detail</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs whitespace-nowrap">{waktu(e.createdAt)}</TableCell>
                    <TableCell className="text-xs">{e.adminEmail}</TableCell>
                    <TableCell className="text-xs font-medium">{AKSI[e.aksi] || e.aksi}</TableCell>
                    <TableCell className="text-xs">{e.targetEmail || "\u2014"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{e.detail || ""}</TableCell>
                  </TableRow>
                ))}
                {entries.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6 text-sm">Belum ada aktivitas.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function Keamanan2FACard() {
  const [status, setStatus] = useState<{ enabled: boolean; setupPending: boolean } | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  async function muatStatus() {
    const d = await fetch("/api/master/2fa").then((r) => r.json()).catch(() => null);
    setStatus(d);
  }
  useEffect(() => { muatStatus(); }, []);
  async function mulaiSetup() {
    setBusy(true);
    const r = await fetch("/api/master/2fa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "setup" }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) setSetup(d); else toast.error(d.error || "Gagal setup");
  }
  async function aksiKode(action: "enable" | "disable") {
    if (code.length !== 6) { toast.error("Masukkan 6 digit kode"); return; }
    setBusy(true);
    const r = await fetch("/api/master/2fa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, code }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { toast.error(d.error || "Gagal"); return; }
    toast.success(action === "enable" ? "2FA diaktifkan" : "2FA dinonaktifkan");
    setSetup(null); setCode(""); muatStatus();
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Keamanan — Autentikasi 2 Langkah (2FA)</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!status ? (
          <p className="text-muted-foreground">Memuat…</p>
        ) : status.enabled ? (
          <>
            <p><Badge className="bg-emerald-600">AKTIF</Badge> Login admin dilindungi kode dari authenticator.</p>
            <div className="flex items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="c2fa">Kode untuk menonaktifkan</Label>
                <Input id="c2fa" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" className="w-32" />
              </div>
              <Button variant="ghost" className="text-destructive" disabled={busy} onClick={() => aksiKode("disable")}>Nonaktifkan</Button>
            </div>
          </>
        ) : setup ? (
          <>
            <p className="text-muted-foreground">Scan / tambahkan ke aplikasi authenticator (Google Authenticator, Authy), lalu masukkan kode untuk mengaktifkan.</p>
            <div className="rounded-lg border p-3 space-y-2">
              <div><span className="text-muted-foreground">Kunci manual: </span><code className="font-mono text-xs break-all">{setup.secret}</code></div>
              <div className="break-all text-xs text-muted-foreground">{setup.uri}</div>
            </div>
            <div className="flex items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="c2fa2">Kode dari authenticator</Label>
                <Input id="c2fa2" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" className="w-32" autoFocus />
              </div>
              <Button disabled={busy} onClick={() => aksiKode("enable")}>Aktifkan 2FA</Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-muted-foreground">Belum aktif. Tambahkan lapisan kedua: kode 6 digit dari aplikasi authenticator saat login admin.</p>
            <Button disabled={busy} onClick={mulaiSetup}>Aktifkan 2FA</Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PendingPaymentsCard({ onDone }: { onDone: () => void }) {
  const [entries, setEntries] = useState<Array<{ id: string; userId: string; jenis: string | null; jumlahIdr: number; kreditTopup: number | null; gatewayRef: string | null; createdAt: number; email: string; namaBisnis: string | null; nama: string | null; nomorWa: string | null; planNama: string | null }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  async function muat() {
    const d = await fetch("/api/master/pending-payments").then((r) => r.json()).catch(() => ({ entries: [] }));
    setEntries(d.entries || []);
  }
  useEffect(() => { muat(); }, []);
  async function konfirmasi(e: { id: string; userId: string }) {
    if (!confirm("Konfirmasi pembayaran ini? Paket/kredit akan aktif.")) return;
    setBusy(e.id);
    const res = await fetch(`/api/master/customers/${e.userId}/confirm-payment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ billingLogId: e.id }) });
    setBusy(null);
    const d = await res.json().catch(() => ({}));
    if (res.ok) { toast.success("Pembayaran dikonfirmasi"); muat(); onDone(); }
    else toast.error(d.error || "Gagal konfirmasi");
  }
  const rp = (n: number) => "Rp " + Number(n || 0).toLocaleString("id-ID");
  const wkt = (t: number) => new Date(t * 1000).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Pembayaran menunggu konfirmasi ({entries.length})</CardTitle></CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Waktu</TableHead><TableHead>Pelanggan</TableHead><TableHead>Item</TableHead>
              <TableHead className="text-right">Jumlah</TableHead><TableHead>Metode</TableHead><TableHead className="text-right">Aksi</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs whitespace-nowrap">{wkt(e.createdAt)}</TableCell>
                  <TableCell className="text-xs"><div className="font-medium">{e.namaBisnis || e.nama || e.email}</div><div className="text-muted-foreground">{e.email}{e.nomorWa ? " · WA " + e.nomorWa : ""}</div></TableCell>
                  <TableCell className="text-xs">{e.jenis === "topup" ? `Top-up ${e.kreditTopup} kredit` : `Paket ${e.planNama || "-"}`}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{rp(e.jumlahIdr)}</TableCell>
                  <TableCell className="text-xs">{e.gatewayRef ? "Gateway" : "Manual BCA"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-2 justify-end">
                      <a className="text-xs underline text-muted-foreground" href={`/api/invoice/${e.id}`} target="_blank" rel="noopener">Tagihan</a>
                      <Button size="sm" disabled={busy !== null} onClick={() => konfirmasi(e)}>Konfirmasi</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {entries.length === 0 && (<TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6 text-sm">Tidak ada pembayaran menunggu konfirmasi.</TableCell></TableRow>)}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function StatCard({
  label, value, tone, small,
}: {
  label: string; value: number | string; tone?: "good" | "bad" | "muted"; small?: boolean;
}) {
  const color =
    tone === "good" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "bad" ? "text-destructive"
    : "text-foreground";
  return (
    <Card>
      <CardContent className="pt-5">
        <div className={`font-bold ${small ? "text-lg" : "text-3xl"} ${color}`}>{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{label}</div>
      </CardContent>
    </Card>
  );
}

function AksiPelanggan({ p, onDone }: { p: Pelanggan; onDone: () => void }) {
  const [openKredit, setOpenKredit] = useState(false);
  const [jumlah, setJumlah] = useState("");
  const [catatan, setCatatan] = useState("");
  const [busy, setBusy] = useState(false);

  // Blokir/aktifkan akun (T6) - terpisah dari status langganan. diblokir=true men-suspend.
  async function setBlokir(diblokir: boolean) {
    setBusy(true);
    const res = await fetch(`/api/master/customers/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diblokir }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success(diblokir ? "Akun disuspend" : "Akun diaktifkan kembali");
      onDone();
    } else {
      toast.error("Gagal mengubah status akun");
    }
  }

  async function tambahKredit() {
    const n = Number(jumlah);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Jumlah harus angka > 0");
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/master/customers/${p.id}/credits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jumlah: n, catatan }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success(`+${n} kredit ditambahkan`);
      setOpenKredit(false);
      setJumlah("");
      setCatatan("");
      onDone();
    } else {
      toast.error("Gagal menambah kredit");
    }
  }

  async function resetPassword() {
    const pw = window.prompt(`Password baru untuk ${p.namaBisnis || p.email} (min 8 karakter):`);
    if (!pw) return;
    if (pw.length < 8) { toast.error("Minimal 8 karakter"); return; }
    setBusy(true);
    const res = await fetch(`/api/master/customers/${p.id}/reset-password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newPassword: pw }) });
    setBusy(false);
    if (res.ok) { toast.success("Password direset \u2014 beri tahu pelanggan password barunya via WhatsApp"); }
    else { const d = await res.json().catch(() => ({})); toast.error(d.error || "Gagal reset password"); }
  }

  async function batalPaket(resume: boolean) {
    if (!resume && !confirm(`Batalkan paket ${p.namaBisnis || p.email}? Akses tetap sampai akhir periode, hanya tidak diperpanjang.`)) return;
    setBusy(true);
    const res = await fetch(`/api/master/customers/${p.id}/cancel-plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resume }) });
    setBusy(false);
    if (res.ok) { toast.success(resume ? "Langganan dilanjutkan" : "Paket dibatalkan (aktif sampai akhir periode)"); onDone(); }
    else { toast.error("Gagal mengubah langganan"); }
  }

  async function konfirmasiBayar() {
    if (!confirm(`Konfirmasi pembayaran paket untuk ${p.namaBisnis || p.email}? Paket akan AKTIF & kredit diisi.`)) return;
    setBusy(true);
    const res = await fetch(`/api/master/customers/${p.id}/confirm-payment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    setBusy(false);
    const d = await res.json().catch(() => ({}));
    if (res.ok) { toast.success("Pembayaran dikonfirmasi — paket aktif"); onDone(); }
    else { toast.error(d.error || "Gagal konfirmasi"); }
  }

  async function exportData() {
    window.open(`/api/master/customers/${p.id}/export`, "_blank");
  }

  async function hapusAkun() {
    if (!confirm(`HAPUS data ${p.namaBisnis || p.email}? Data pribadi di-anonimkan & semua brand/konten dihapus PERMANEN (riwayat tagihan tetap disimpan utk catatan keuangan). Akun tak bisa login lagi.`)) return;
    const ketik = window.prompt("Tindakan ini PERMANEN. Ketik HAPUS untuk melanjutkan:");
    if (ketik !== "HAPUS") { if (ketik !== null) toast.error("Dibatalkan \u2014 teks tidak cocok"); return; }
    setBusy(true);
    const res = await fetch(`/api/master/customers/${p.id}/anonymize`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ konfirmasi: "HAPUS" }) });
    setBusy(false);
    const d = await res.json().catch(() => ({}));
    if (res.ok) { toast.success(`Data dihapus \u2014 ${d.brand_dihapus ?? 0} brand & ${d.konten_dihapus ?? 0} konten dibersihkan`); onDone(); }
    else { toast.error(d.error || "Gagal menghapus data"); }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {p.status === "tanpa_paket" && (
        <Button size="sm" onClick={konfirmasiBayar} disabled={busy}>Konfirmasi bayar</Button>
      )}
      <Dialog open={openKredit} onOpenChange={setOpenKredit}>
        <DialogTrigger render={<Button size="sm" variant="outline">+ Kredit</Button>} />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tambah kredit — {p.namaBisnis || p.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="jumlah">Jumlah kredit</Label>
              <Input
                id="jumlah" type="number" min={1} value={jumlah}
                onChange={(e) => setJumlah(e.target.value)} placeholder="mis. 50" autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="catatan">Catatan (opsional)</Label>
              <Input
                id="catatan" value={catatan}
                onChange={(e) => setCatatan(e.target.value)}
                placeholder="mis. kompensasi render gagal"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Saldo sekarang: {p.saldoKredit} kredit. Perubahan tercatat di riwayat kredit pelanggan.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenKredit(false)} disabled={busy}>Batal</Button>
            <Button onClick={tambahKredit} disabled={busy}>{busy ? "Menyimpan…" : "Tambah"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Button size="sm" variant="ghost" onClick={resetPassword} disabled={busy}>Reset PW</Button>
      {p.diblokirAdmin ? (
        <Button size="sm" variant="outline" onClick={() => setBlokir(false)} disabled={busy}>
          Aktifkan
        </Button>
      ) : (
        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setBlokir(true)} disabled={busy}>
          Suspend
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={exportData} disabled={busy}>Export</Button>
      <Button size="sm" variant="ghost" className="text-destructive" onClick={hapusAkun} disabled={busy}>Hapus</Button>
    </div>
  );
}
