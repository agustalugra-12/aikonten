"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Halaman pendaftaran (2026-09-30, baru - sebelumnya tidak ada sama sekali). Sesuai kontrak
// /api/auth/signup: { email, password, namaBisnis? }, password minimal 8 karakter. Signup
// membuat akun dengan planId=null (belum berlangganan) & auto-login. Setelah daftar, arahkan
// ke "/" - alur pilih paket + pembayaran menyusul (lihat catatan masukan). Konfirmasi
// password dicek di sisi klien supaya salah ketik ketahuan sebelum submit.
export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [namaBisnis, setNamaBisnis] = useState("");
  const [password, setPassword] = useState("");
  const [konfirmasi, setKonfirmasi] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password minimal 8 karakter");
      return;
    }
    if (password !== konfirmasi) {
      setError("Konfirmasi password tidak cocok");
      return;
    }

    setLoading(true);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, namaBisnis }),
    });
    setLoading(false);
    if (res.ok) {
      // Auto-login sudah terjadi di server (cookie di-set). Arahkan ke dashboard;
      // pemilihan paket dilakukan dari sana (alur pilih-paket + bayar menyusul).
      router.push("/");
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Gagal mendaftar");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-heading">Daftar KontenPilot</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                required
                placeholder="nama@email.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="namaBisnis">Nama bisnis (opsional)</Label>
              <Input
                id="namaBisnis"
                value={namaBisnis}
                onChange={(e) => setNamaBisnis(e.target.value)}
                placeholder="mis. Warung Kopi Senja"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="Minimal 8 karakter"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="konfirmasi">Ulangi password</Label>
              <Input
                id="konfirmasi"
                type="password"
                value={konfirmasi}
                onChange={(e) => setKonfirmasi(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Mendaftar…" : "Daftar"}
            </Button>
          </form>
          <p className="text-sm text-muted-foreground text-center mt-4">
            Sudah punya akun?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Masuk di sini
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
