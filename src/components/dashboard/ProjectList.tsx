"use client";

import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { Project } from "@/types";
import { STATUS_LABEL, STATUS_VARIANT } from "@/types";

// "Coba Lagi" (2026-08-07, permintaan Agus - "yang gagal publis kembali ke draft atau
// kamu taruh dmna" - ternyata JAWABANNYA: project "failed" nongol DI SINI [tabel ini],
// TAPI sebelum ini murni tampilan baca-saja, tidak ada cara apa pun buat tindak lanjuti
// dari sini - bikin project gagal terasa "hilang", sesuai kebingungan Agus). Panggil
// ulang endpoint process yang SAMA persis dgn generate awal (script/caption project
// SUDAH ada dari percobaan sebelumnya, cuma tahap render/publish yang gagal) - aman
// dipanggil ulang kapan saja, processProject.ts tidak py guard status yang mencegahnya.
export function ProjectList({ projects, onRetry }: { projects: Project[]; onRetry?: () => void }) {
  const [retrying, setRetrying] = useState<string | null>(null);

  async function handleRetry(id: string) {
    setRetrying(id);
    try {
      const res = await fetch(`/api/projects/${id}/process`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || "Gagal coba ulang, coba lagi nanti");
        return;
      }
      toast.success("Diproses ulang - cek status beberapa saat lagi");
      onRetry?.();
    } catch {
      toast.error("Gagal coba ulang, coba lagi nanti");
    } finally {
      setRetrying(null);
    }
  }

  if (projects.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Belum ada konten utk brand ini.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Tipe</TableHead>
          <TableHead>Skrip</TableHead>
          <TableHead>Caption</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Dibuat</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {projects.map((p) => (
          <TableRow key={p.id}>
            <TableCell className="capitalize">{p.type}</TableCell>
            <TableCell className="max-w-[200px] truncate">{p.script}</TableCell>
            <TableCell className="max-w-[280px] truncate">{p.generatedCaption || "-"}</TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANT[p.status]}>{STATUS_LABEL[p.status]}</Badge>
              {p.status === "failed" && p.errorMessage && (
                <p className="text-xs text-destructive mt-1 max-w-[200px] truncate" title={p.errorMessage}>
                  {p.errorMessage}
                </p>
              )}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {new Date(p.createdAt).toLocaleString("id-ID")}
            </TableCell>
            <TableCell>
              {p.status === "failed" && (
                <Button size="sm" variant="outline" disabled={retrying === p.id} onClick={() => handleRetry(p.id)}>
                  {retrying === p.id ? "Memproses…" : "Coba Lagi"}
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
