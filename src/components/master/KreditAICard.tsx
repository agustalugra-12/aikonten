"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

// Kartu pemakaian & sisa kredit AI (OpenAI/Gemini) di Master Dashboard (2026-10-11).
// Saldo asli provider tak tersedia via API -> "sisa" = saldo yang admin input (POST
// /api/master/llm-balance) dikurangi pemakaian (llm_usage_log) sejak input itu. Pemakaian
// bulan ini & total selalu dari log.
type Prov = {
  provider: string; label: string; bulanUsd: number; totalUsd: number; panggilan: number;
  saldo: { amountUsd: number; at: number } | null; terpakaiSejak: number | null; sisaUsd: number | null;
};
const usd = (n: number) => "$" + (n ?? 0).toFixed(2);

export default function KreditAICard() {
  const [rows, setRows] = useState<Prov[] | null>(null);
  async function muat() {
    try { const d = await fetch("/api/master/llm-usage").then((r) => r.json()); setRows(d.providers || []); }
    catch { setRows([]); }
  }
  useEffect(() => { muat(); }, []);
  const known = ["openai", "gemini"];
  const list: Prov[] = known.map(
    (p) => (rows || []).find((r) => r.provider === p) ||
      { provider: p, label: p === "openai" ? "OpenAI (GPT)" : "Gemini", bulanUsd: 0, totalUsd: 0, panggilan: 0, saldo: null, terpakaiSejak: null, sisaUsd: null },
  );
  return (
    <div>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Kredit AI (biaya API)</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {list.map((p) => <ProvCard key={p.provider} p={p} onDone={muat} />)}
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        Saldo asli OpenAI/Gemini tidak tersedia via API — angka <b>sisa</b> dihitung dari saldo yang kamu input
        dikurangi pemakaian sejak itu. Perbarui saat kamu top-up / cek dashboard provider.
      </p>
    </div>
  );
}

function ProvCard({ p, onDone }: { p: Prov; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState(false);
  const low = p.sisaUsd !== null && p.sisaUsd <= 2;
  async function simpan() {
    const n = Number(amt);
    if (!Number.isFinite(n) || n < 0) { toast.error("Masukkan angka USD >= 0"); return; }
    setBusy(true);
    const res = await fetch("/api/master/llm-balance", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: p.provider, amountUsd: n }),
    });
    setBusy(false);
    if (res.ok) { toast.success(`Saldo ${p.label} diperbarui`); setOpen(false); setAmt(""); onDone(); }
    else { const d = await res.json().catch(() => ({})); toast.error(d.error || "Gagal menyimpan"); }
  }
  return (
    <Card className={low ? "border-destructive" : ""}>
      <CardContent className="pt-5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-heading font-semibold">{p.label}</span>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button size="sm" variant="outline">Set saldo</Button>} />
            <DialogContent>
              <DialogHeader><DialogTitle>Set saldo {p.label}</DialogTitle></DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="amt">Saldo sekarang (USD)</Label>
                <Input id="amt" type="number" step="0.01" min={0} value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="mis. 20" autoFocus />
                <p className="text-xs text-muted-foreground">
                  Cek saldo di dashboard provider, masukkan di sini. Pemakaian berikutnya dikurangi dari angka ini.
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Batal</Button>
                <Button onClick={simpan} disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <div className={`mt-3 text-3xl font-bold ${low ? "text-destructive" : ""}`}>
          {p.sisaUsd !== null ? usd(p.sisaUsd) : "—"}
        </div>
        <div className="text-xs text-muted-foreground">
          {p.sisaUsd !== null ? "sisa estimasi" + (low ? " · hampir habis!" : "") : "set saldo untuk lihat sisa"}
        </div>
        <div className="mt-3 pt-3 border-t text-xs text-muted-foreground space-y-1">
          <div>Pemakaian bulan ini: <span className="text-foreground font-medium">{usd(p.bulanUsd)}</span></div>
          <div>Total: {usd(p.totalUsd)} · {p.panggilan.toLocaleString("id-ID")} panggilan</div>
        </div>
      </CardContent>
    </Card>
  );
}
