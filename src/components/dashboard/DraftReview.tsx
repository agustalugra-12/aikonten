"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { getSimilarityTier, SIMILARITY_TIER_LABELS, SIMILARITY_TIER_COLORS } from "@/lib/ai/similarityTier";
import type { Project, ProjectDetail, SocialAccount } from "@/types";

const PLATFORM_LABEL: Record<SocialAccount["platform"], string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  tiktok: "TikTok",
};

// Lewatkan pratinjau lewat domain aplikasi sendiri, bukan hotlink langsung ke r2.dev
// (2026-08-05, lihat catatan lengkap di api/media-proxy/route.ts - domain r2.dev
// kemungkinan kena blokir jaringan di sisi Agus, publish sungguhan tidak lewat jalur ini
// sama sekali jadi tidak terdampak).
function previewUrl(fileUrl: string): string {
  return `/api/media-proxy?url=${encodeURIComponent(fileUrl)}`;
}

// Download foto (2026-09-06, permintaan Agus - "buat fitul download konten untuk foto")
// - lewat media-proxy?download=1 (lihat catatan lengkap di api/media-proxy/route.ts),
// BUKAN link R2 langsung - `<a download>` browser TIDAK dihormati utk resource cross-
// origin, proxy ini yg paksa Content-Disposition: attachment dari sisi server.
function downloadUrl(fileUrl: string): string {
  return `/api/media-proxy?url=${encodeURIComponent(fileUrl)}&download=1`;
}

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
  const [busy, setBusy] = useState<"publish" | "delete" | "schedule" | null>(null);
  const [intelScore, setIntelScore] = useState<{ overallScore: number; grade: string } | null>(null);
  // Manual Per-Post Scheduling (2026-08-25, PRD §26) - input datetime-local NATIVE
  // (browser sudah py date+time picker bawaan, tidak perlu library tambahan).
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleValue, setScheduleValue] = useState("");
  const [scheduleMin] = useState(() => new Date(Date.now() + 60000).toISOString().slice(0, 16));
  // Content Brief (2026-08-26, PRD §12, Task Plan 6) - fetch LAZY (cuma saat expand),
  // murni assembly read-only (lihat contentBrief.ts), tidak ada biaya AI tapi tetap
  // tidak perlu selalu di-fetch tiap draft dimuat kalau tidak dilihat.
  const [briefOpen, setBriefOpen] = useState(false);
  const [brief, setBrief] = useState<{
    objective: string | null; targetAudience: string | null; platforms: string[];
    pillar: string | null; topic: string | null; angle: string | null; hook: string | null;
    coreMessage: string | null; storytellingStructure: string | null; visualDirection: string | null;
    cta: string | null; referencePatterns: string | null; score: number | null;
    retentionRisks: string[];
  } | null>(null);

  function handleToggleBrief() {
    if (!briefOpen && !brief) {
      fetch(`/api/projects/${project.id}/brief`).then((r) => r.json()).then(setBrief).catch(() => {});
    }
    setBriefOpen((v) => !v);
  }

  useEffect(() => {
    fetch(`/api/projects/${project.id}`)
      .then(async (res) => { if (res.ok) setDetail(await res.json()); });
    // Fetch intelligence score
    fetch(`/api/projects/${project.id}/intelligence`)
      .then((r) => r.json())
      .then((d) => { if (d.overallScore != null) setIntelScore({ overallScore: d.overallScore, grade: d.grade }); })
      .catch(() => {});
  }, [project.id]);

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
    } else if (updated.status === "partial") {
      // 2026-08-07 - sebagian platform gagal, akan dicoba ulang otomatis (lihat
      // cron/auto-publish.ts) tanpa publish dobel ke platform yg sudah sukses.
      toast.warning("Sebagian platform gagal - akan dicoba ulang otomatis nanti, cek notifikasi Telegram");
    } else {
      toast.error(updated.errorMessage || "Publish gagal, cek notifikasi Telegram");
    }
    onChange();
  }

  async function handleSchedule() {
    if (!scheduleValue) {
      toast.error("Pilih tanggal & jam dulu");
      return;
    }
    setBusy("schedule");
    const res = await fetch(`/api/projects/${project.id}/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledFor: new Date(scheduleValue).toISOString() }),
    });
    setBusy(null);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Gagal menjadwalkan");
      return;
    }
    toast.success(`Dijadwalkan tayang ${new Date(scheduleValue).toLocaleString("id-ID")}`);
    setScheduleOpen(false);
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
  // Judul (2026-08-10, laporan Agus - lihat catatan lengkap di types/index.ts) - HANYA
  // ada utk project YouTube Editorial Engine (youtubeMetadata terisi); brand generik
  // (Pelangi/Laundry) tidak py konsep "judul" terpisah dari caption, script-nya sendiri
  // sudah pendek jadi ditampilkan apa adanya spt sebelumnya.
  let youtubeTitle: string | null = null;
  if (project.youtubeMetadata) {
    try {
      const meta = JSON.parse(project.youtubeMetadata) as { titles?: string[]; selectedTitleIndex?: number };
      youtubeTitle = meta.titles?.[meta.selectedTitleIndex ?? 0] || meta.titles?.[0] || null;
    } catch {
      youtubeTitle = null;
    }
  }

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Badge variant="outline" className="capitalize mb-1">
            {project.type}
          </Badge>
          {project.similarityScore != null && project.similarityScore > 0 && (() => {
            const tier = getSimilarityTier(project.similarityScore);
            return (
              <Badge className={`ml-1 mb-1 ${SIMILARITY_TIER_COLORS[tier]}`}>
                Similarity: {project.similarityScore}% - {SIMILARITY_TIER_LABELS[tier]}
              </Badge>
            );
          })()}
          {intelScore && (
            <Badge className={`ml-1 mb-1 ${intelScore.grade === "A" ? "bg-green-100 text-green-800" : intelScore.grade === "B" ? "bg-blue-100 text-blue-800" : intelScore.grade === "C" ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800"}`}>
              Score: {intelScore.overallScore}/100 ({intelScore.grade})
            </Badge>
          )}
          {youtubeTitle ? (
            <p className="text-sm font-semibold max-w-xl">{youtubeTitle}</p>
          ) : (
            <p className="text-sm text-muted-foreground max-w-xl">{project.script}</p>
          )}
        </div>
        <span className="text-xs text-muted-foreground shrink-0">
          {new Date(project.createdAt).toLocaleString("id-ID")}
        </span>
      </div>

      {!detail ? (
        <p className="text-sm text-muted-foreground">Memuat pratinjau...</p>
      ) : finalVideo ? (
        <video controls src={previewUrl(finalVideo.fileUrl)} className="w-full max-h-[420px] rounded-md bg-black" />
      ) : finalImages.length === 1 ? (
        // Foto TUNGGAL (poster) - tampil PENUH & UTUH (2026-08-05, bug nyata dilaporkan
        // Agus: sebelumnya poster foto tunggal ikut dipaksa masuk grid-cols-3 yg dibuat
        // utk carousel BANYAK foto, jadi cuma kelihatan 1/3 lebar & KEPOTONG persegi
        // (aspect-square + object-cover) - poster teks/badge/layout-nya jadi hilang
        // sebagian/nyaris tidak kelihatan. object-contain (bukan cover) supaya rasio asli
        // poster (1:1/4:5) tetap utuh, tidak dipaksa persegi.
        <div className="space-y-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl(finalImages[0].fileUrl)}
            alt=""
            className="w-full max-h-[520px] object-contain rounded-md bg-muted"
          />
          <a href={downloadUrl(finalImages[0].fileUrl)} download>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Download className="w-3.5 h-3.5" /> Unduh Foto
            </Button>
          </a>
        </div>
      ) : finalImages.length > 1 ? (
        <div className="grid grid-cols-3 gap-2">
          {finalImages.map((img, i) => (
            <div key={img.id} className="space-y-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl(img.fileUrl)} alt="" className="w-full aspect-square object-cover rounded-md" />
              <a href={downloadUrl(img.fileUrl)} download>
                <Button variant="outline" size="sm" className="w-full gap-1 text-xs">
                  <Download className="w-3 h-3" /> Foto {i + 1}
                </Button>
              </a>
            </div>
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

      {/* Content Brief (2026-08-26, PRD §12, Task Plan 6) */}
      <div>
        <Button variant="ghost" size="sm" className="text-xs h-6 px-2" onClick={handleToggleBrief}>
          {briefOpen ? "Sembunyikan Brief" : "Lihat Brief"}
        </Button>
        {briefOpen && (
          !brief ? (
            <p className="text-xs text-muted-foreground px-2">Memuat brief...</p>
          ) : (
            <div className="text-xs text-muted-foreground rounded-md border p-3 mt-1 space-y-1">
              {brief.objective && <p><span className="font-medium text-foreground">Objective:</span> {brief.objective}</p>}
              {brief.targetAudience && <p><span className="font-medium text-foreground">Target Audience:</span> {brief.targetAudience}</p>}
              {brief.platforms.length > 0 && <p><span className="font-medium text-foreground">Platform:</span> {brief.platforms.join(", ")}</p>}
              {brief.pillar && <p><span className="font-medium text-foreground">Pilar:</span> {brief.pillar}</p>}
              {brief.angle && <p><span className="font-medium text-foreground">Angle:</span> {brief.angle}</p>}
              {brief.hook && <p><span className="font-medium text-foreground">Hook:</span> {brief.hook}</p>}
              {brief.storytellingStructure && <p><span className="font-medium text-foreground">Struktur:</span> {brief.storytellingStructure}</p>}
              {brief.visualDirection && <p><span className="font-medium text-foreground">Arahan Visual:</span> {brief.visualDirection}</p>}
              {brief.cta && <p><span className="font-medium text-foreground">CTA:</span> {brief.cta}</p>}
              {brief.referencePatterns && <p><span className="font-medium text-foreground">Alasan Terpilih:</span> {brief.referencePatterns}</p>}
              {brief.score != null && <p><span className="font-medium text-foreground">Opportunity Score:</span> {brief.score}/100</p>}
              {brief.retentionRisks.length > 0 && (
                <div className="pt-1">
                  <span className="font-medium text-foreground">Resiko Retensi:</span>
                  <ul className="list-disc list-inside">
                    {brief.retentionRisks.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )
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
        <div className="flex items-center gap-2 flex-wrap">
          {scheduleOpen && (
            <>
              <input
                type="datetime-local"
                className="text-xs border rounded-md px-2 py-1.5"
                value={scheduleValue}
                min={scheduleMin}
                onChange={(e) => setScheduleValue(e.target.value)}
              />
              <Button size="sm" variant="secondary" onClick={handleSchedule} disabled={!!busy}>
                {busy === "schedule" ? "Menjadwalkan..." : "Konfirmasi"}
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={() => setScheduleOpen((v) => !v)} disabled={!!busy || accounts.length === 0}>
            {scheduleOpen ? "Batal" : "Jadwalkan"}
          </Button>
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
