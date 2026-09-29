"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Halaman login (2026-09-30, diperbaiki) - versi lama HANYA mengirim { password } (sisa
// dari repo asal single-admin 1-password), padahal API multi-tenant butuh { email, password }
// -> login selalu gagal. Sekarang: email + password sesuai kontrak /api/auth/login. Setelah
// sukses, cek /api/master/me: kalau akun admin -> ke /master, selain itu -> dashboard konten.
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      setLoading(false);
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Gagal login");
      return;
    }
    // Arahkan admin langsung ke master dashboard; pelanggan biasa ke dashboard konten.
    const me = await fetch("/api/master/me").then((r) => r.json()).catch(() => ({ isAdmin: false }));
    router.push(me.isAdmin ? "/master" : "/");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-heading">Masuk ke KontenPilot</CardTitle>
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
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Masuk…" : "Masuk"}
            </Button>
          </form>
          <p className="text-sm text-muted-foreground text-center mt-4">
            Belum punya akun?{" "}
            <Link href="/signup" className="text-primary hover:underline">
              Daftar di sini
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
