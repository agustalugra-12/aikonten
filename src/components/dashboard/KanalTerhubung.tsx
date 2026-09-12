"use client";

import { useFetchedData } from "@/lib/useFetchedData";
import { PlatformIcon } from "@/components/dashboard/PlatformIcon";
import { ConnectBufferDialog } from "@/components/dashboard/ConnectBufferDialog";
import { ChannelProfileDialog } from "@/components/dashboard/ChannelProfileDialog";
import type { SocialAccount } from "@/types";

// Kanal Terhubung - port Stitch channel workspace (2026-09-12, PRD). VERSI JUJUR: backend
// social-accounts hanya simpan id/platform/publishVia/username - jadi field mockup
// (followers/token-expiry/engagement/API-limit/latency) TIDAK ditampilkan (bukan angka
// palsu). Yg nyata: daftar akun tersambung + aksi sambung baru (reuse flow existing
// YouTube/Meta/Buffer + ChannelProfileDialog). Ikon Material Symbols + PlatformIcon.

const PLATFORM_LABEL: Record<SocialAccount["platform"], string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  tiktok: "TikTok",
};

// Status koneksi NYATA dari social_accounts (connected + token_expires_at). Bukan fiksi.
// token_expires_at bisa detik/ms - normalisasi. Akun tanpa expiry (Buffer) = anggap OK.
function accountStatus(acc: SocialAccount): { label: string; dot: string; cls: string } {
  if (acc.connected === false) return { label: "Terputus", dot: "bg-[#ba1a1a]", cls: "bg-[#ffdad6] text-[#93000a]" };
  const exp = acc.tokenExpiresAt;
  if (exp) {
    const ms = exp < 1e12 ? exp * 1000 : exp;
    const daysLeft = (ms - Date.now()) / 86400000;
    if (daysLeft < 0) return { label: "Token kedaluwarsa", dot: "bg-[#ba1a1a]", cls: "bg-[#ffdad6] text-[#93000a]" };
    if (daysLeft < 7) return { label: `Token ${Math.max(0, Math.round(daysLeft))} hari lagi`, dot: "bg-[#555f6d]", cls: "bg-[#e2e8f8] text-[#151c27]" };
  }
  return { label: "Tersambung", dot: "bg-black", cls: "bg-[#e7eefe] text-[#151c27]" };
}

export function KanalTerhubung({ brandId }: { brandId: string }) {
  const { data: accountsRaw, loading, refetch } = useFetchedData<SocialAccount[]>(
    () => fetch(`/api/brands/${brandId}/social-accounts`).then((r) => r.json()),
    [brandId]
  );
  const accounts = accountsRaw ?? [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[#555f6d]">
            <span>Distribusi</span>
            <span className="text-[#c6c6cd]">•</span>
            <span className="text-[#151c27] font-semibold">Kanal Terhubung</span>
          </div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-[#151c27] mt-1">Saluran Sosial</h1>
          <p className="text-[13px] text-[#555f6d] mt-0.5">
            {loading ? "Memuat…" : `${accounts.length} kanal tersambung untuk distribusi konten.`}
          </p>
        </div>
      </div>

      {/* Kartu akun tersambung */}
      {loading ? (
        <p className="text-[13px] text-[#555f6d] py-10 text-center">Memuat...</p>
      ) : accounts.length === 0 ? (
        <div className="rounded-xl bg-white ring-1 ring-[#e7eefe] p-8 text-center">
          <span className="material-symbols-outlined text-[40px] text-[#c6c6cd]">hub</span>
          <p className="text-[13px] text-[#151c27] mt-2 font-medium">Belum ada kanal tersambung</p>
          <p className="text-[11px] text-[#555f6d] mt-0.5">Sambungkan akun di bawah untuk mulai mempublikasikan konten.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((acc) => {
            const st = accountStatus(acc);
            return (
            <div key={acc.id} className="rounded-xl bg-white ring-1 ring-[#e7eefe] shadow-sm p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-[#f0f3ff] flex items-center justify-center shrink-0">
                    <PlatformIcon platform={acc.platform} className="w-[18px] h-[18px] text-[#151c27]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-[#151c27] leading-tight">{PLATFORM_LABEL[acc.platform]}</p>
                    <p className="text-[11px] text-[#555f6d] truncate">@{acc.username}</p>
                  </div>
                </div>
                <span className={"inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0 " + st.cls}>
                  <span className={"w-1.5 h-1.5 rounded-full inline-block " + st.dot} />
                  {st.label}
                </span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-[#e7eefe]">
                <span className="text-[11px] text-[#555f6d]">
                  {acc.publishVia === "buffer" ? "Publikasi via Buffer" : "Publikasi native"}
                </span>
                {acc.platform === "youtube" && (
                  <ChannelProfileDialog socialAccountId={acc.id} username={acc.username} />
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* Hubungkan akun baru */}
      <div className="rounded-xl bg-white ring-1 ring-[#e7eefe] shadow-sm p-4">
        <p className="font-heading text-sm font-semibold text-[#151c27] mb-1">Hubungkan Akun Baru</p>
        <p className="text-[11px] text-[#555f6d] mb-3">YouTube &amp; Meta (Instagram/Facebook) via OAuth; TikTok/lainnya via Buffer.</p>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/auth/youtube/connect?brandId=${brandId}`}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white ring-1 ring-[#e7eefe] hover:ring-[#c6c6cd] text-[13px] font-medium text-[#151c27]"
          >
            <span className="material-symbols-outlined text-[16px]">play_circle</span> Sambungkan YouTube
          </a>
          <a
            href={`/api/auth/meta/connect?brandId=${brandId}`}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white ring-1 ring-[#e7eefe] hover:ring-[#c6c6cd] text-[13px] font-medium text-[#151c27]"
          >
            <span className="material-symbols-outlined text-[16px]">photo_camera</span> Sambungkan Instagram/Facebook
          </a>
          <ConnectBufferDialog brandId={brandId} onConnected={refetch} />
        </div>
      </div>
    </div>
  );
}
