"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConnectBufferDialog } from "@/components/dashboard/ConnectBufferDialog";
import { ChannelProfileDialog } from "@/components/dashboard/ChannelProfileDialog";
import { useFetchedData } from "@/lib/useFetchedData";
import type { SocialAccount } from "@/types";

const PLATFORM_LABEL: Record<SocialAccount["platform"], string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  tiktok: "TikTok",
};
export function SocialAccounts({ brandId }: { brandId: string }) {
  const { data: accountsRaw, loading, refetch: load } = useFetchedData<SocialAccount[]>(
    () => fetch(`/api/brands/${brandId}/social-accounts`).then((res) => res.json()),
    [brandId]
  );
  const accounts = accountsRaw ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Akun Sosial Media</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">Memuat...</p>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada akun tersambung utk brand ini.</p>
        ) : (
          <ul className="space-y-2">
            {accounts.map((acc) => (
              <li key={acc.id} className="flex items-center gap-2 text-sm flex-wrap">
                <Badge variant="outline">{PLATFORM_LABEL[acc.platform]}</Badge>
                <span>@{acc.username}</span>
                {acc.publishVia === "buffer" && (
                  <span className="text-xs text-muted-foreground">(via Buffer)</span>
                )}
                {acc.platform === "youtube" && (
                  <ChannelProfileDialog socialAccountId={acc.id} username={acc.username} />
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<a href={`/api/auth/youtube/connect?brandId=${brandId}`} />}
          >
            + Sambungkan YouTube
          </Button>
          <ConnectBufferDialog brandId={brandId} onConnected={load} />
        </div>
      </CardContent>
    </Card>
  );
}
