"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConnectBufferDialog } from "@/components/dashboard/ConnectBufferDialog";
import type { SocialAccount } from "@/types";

const PLATFORM_LABEL: Record<SocialAccount["platform"], string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  tiktok: "TikTok",
};
export function SocialAccounts({ brandId }: { brandId: string }) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/brands/${brandId}/social-accounts`);
    setAccounts(await res.json());
    setLoading(false);
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

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
              <li key={acc.id} className="flex items-center gap-2 text-sm">
                <Badge variant="outline">{PLATFORM_LABEL[acc.platform]}</Badge>
                <span>@{acc.username}</span>
                {acc.publishVia === "buffer" && (
                  <span className="text-xs text-muted-foreground">(via Buffer)</span>
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
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<a href={`/api/auth/meta/connect?brandId=${brandId}`} />}
          >
            + Sambungkan Facebook &amp; Instagram
          </Button>
          <ConnectBufferDialog brandId={brandId} onConnected={load} />
        </div>
      </CardContent>
    </Card>
  );
}
