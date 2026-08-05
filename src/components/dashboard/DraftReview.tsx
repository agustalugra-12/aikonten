"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import type { Project, ProjectDetail, SocialAccount } from "@/types";

const PLATFORM_LABEL: Record<SocialAccount["platform"], string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  tiktok: "TikTok",
};

// Draft review (2026-08-04, permintaan Agus - "biar aku cek di draft AI konten" sblm
// tayang). Konten AI (video/carousel/⚡ Konten Otomatis) sekarang berhenti di status
// "ready" & TIDAK auto-publish lagi (lihat processProject.ts) - di sinilah Agus lihat
// hasil jadinya (video/foto+overlay, caption, hashtag) & keputusan terakhir ada di
// tangannya: publikasikan sekarang, atau hapus kalau tidak dipakai.
export function DraftReview({ brandId, projects, onChange }: { brandId: string; projects: Project[]; onChange: () => void }) {
  const drafts = projects.filter((p) => p.status === "ready");
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);

  useEffect(() => {
    fetch(`/api/brands/${brandId}/social-accounts`)
      .then((res) => res.json())
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, [brandId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Draft Menunggu Review {drafts.length > 0 && `(${drafts.length})`}</CardTitle>
        <CardDescription>Cek hasil AI dulu sebelum tayang ke sosmed.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {drafts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Belum ada draft menunggu. Konten baru (upload manual atau ⚡ Konten Otomatis) akan muncul di sini dulu
            sebelum dipublikasikan.
          </p>
        ) : (
          drafts.map((p) => <DraftCard key={p.id} project={p} accounts={accounts} onChange={onChange} />)
        )}
      </CardContent>
    </Card>
  );
}

function DraftCard({ project, accounts, onChange }: { project: Project; accounts: SocialAccount[]; onChange: () => void }) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [busy, setBusy] = useState<"publish" | "delete" | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${project.id}`);
    if (res.ok) setDetail(await res.json());
  }, [project.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handlePublish() {
    setBusy("publish");
    const res = await fetch(`/api/projects/${project.id}/publish`, { method: "POST" });
    setBusy(null);
    if (!res.ok) {
      toast.error("Gagal publikasikan, coba lagi");
      return;
    }
    const updated = await res.json();
    if (updated.status === "published") {
      toast.success("Berhasil dipublikasikan!");
    } else {
      toast.error(updated.errorMessage || "Publish gagal, cek notifikasi Telegram");
    }
    onChange();
  }

  async function handleDelete() {
    if (!confirm("Hapus draft ini? Tidak bisa dibatalkan.")) return;
    setBusy("delete");
    const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      toast.error("Gagal hapus draft");
      return;
    }
    toast.success("Draft dihapus");
    onChange();
  }

  const finalVideo = detail?.assets.find((a) => a.type === "final_video");
  const finalImages = detail?.assets.filter((a) => a.type === "final_image") || [];
  const hashtags = project.generatedHashtags ? (JSON.parse(project.generatedHashtags) as string[]) : [];

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Badge variant="outline" className="capitalize mb-1">
            {project.type}
          </Badge>
          <p className="text-sm text-muted-foreground max-w-xl">{project.script}</p>
        </div>
        <span className="text-xs text-muted-foreground shrink-0">
          {new Date(project.createdAt).toLocaleString("id-ID")}
        </span>
      </div>

      {!detail ? (
        <p className="text-sm text-muted-foreground">Memuat pratinjau...</p>
      ) : finalVideo ? (
        <video controls src={finalVideo.fileUrl} className="w-full max-h-[420px] rounded-md bg-black" />
      ) : finalImages.length === 1 ? (
        // Foto TUNGGAL (poster) - tampil PENUH & UTUH (2026-08-05, bug nyata dilaporkan
        // Agus: sebelumnya poster foto tunggal ikut dipaksa masuk grid-cols-3 yg dibuat
        // utk carousel BANYAK foto, jadi cuma kelihatan 1/3 lebar & KEPOTONG persegi
        // (aspect-square + object-cover) - poster teks/badge/layout-nya jadi hilang
        // sebagian/nyaris tidak kelihatan. object-contain (bukan cover) supaya rasio asli
        // poster (1:1/4:5) tetap utuh, tidak dipaksa persegi.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={finalImages[0].fileUrl}
          alt=""
          className="w-full max-h-[520px] object-contain rounded-md bg-muted"
        />
      ) : finalImages.length > 1 ? (
        <div className="grid grid-cols-3 gap-2">
          {finalImages.map((img) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={img.id} src={img.fileUrl} alt="" className="w-full aspect-square object-cover rounded-md" />
          ))}
        </div>
      ) : (
        <p className="text-sm text-destructive">Aset final belum tersedia utk project ini.</p>
      )}

      <div className="space-y-1">
        <p className="text-sm whitespace-pre-wrap">{project.generatedCaption}</p>
        {hashtags.length > 0 && (
          <p className="text-sm text-muted-foreground">{hashtags.map((h) => `#${h}`).join(" ")}</p>
        )}
      </div>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          {accounts.length === 0 ? (
            <span className="text-xs text-muted-foreground">Belum ada akun sosmed tersambung</span>
          ) : (
            <>
              <span className="text-xs text-muted-foreground mr-1">Akan tayang ke:</span>
              {accounts.map((acc) => (
                <Badge key={acc.id} variant="secondary" className="text-xs">
                  {PLATFORM_LABEL[acc.platform]}
                </Badge>
              ))}
            </>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="destructive" size="sm" onClick={handleDelete} disabled={!!busy}>
            {busy === "delete" ? "Menghapus..." : "Hapus"}
          </Button>
          <Button size="sm" onClick={handlePublish} disabled={!!busy || accounts.length === 0}>
            {busy === "publish" ? "Memublikasikan..." : "Publikasikan Sekarang"}
          </Button>
        </div>
      </div>
    </div>
  );
}
