"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BrandSwitcher } from "@/components/dashboard/BrandSwitcher";
import { NewBrandDialog } from "@/components/dashboard/NewBrandDialog";
import { NewProjectDialog } from "@/components/dashboard/NewProjectDialog";
import { ProjectList } from "@/components/dashboard/ProjectList";
import { SocialAccounts } from "@/components/dashboard/SocialAccounts";
import { AnalyticsSummary } from "@/components/dashboard/AnalyticsSummary";
import { ContentIdeas } from "@/components/dashboard/ContentIdeas";
import { StoryboardDialog } from "@/components/dashboard/StoryboardDialog";
import { FootageBankDialog } from "@/components/dashboard/FootageBankDialog";
import { AutoContentButton } from "@/components/dashboard/AutoContentButton";
import { toast } from "sonner";
import type { Brand, Project } from "@/types";

const LAST_BRAND_KEY = "kontenpilot_last_brand";

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center text-muted-foreground">Memuat...</div>}>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  // Diisi kalau Agus klik salah satu "Ide Konten" - lihat ContentIdeas.tsx. Dipakai
  // sbg `key` remount NewProjectDialog di bawah biar initialScript-nya benar2 baru.
  const [prefillScript, setPrefillScript] = useState<string | null>(null);

  const loadBrands = useCallback(async () => {
    const res = await fetch("/api/brands");
    const data: Brand[] = await res.json();
    setBrands(data);
    const remembered = typeof window !== "undefined" ? localStorage.getItem(LAST_BRAND_KEY) : null;
    const stillExists = remembered && data.some((b) => b.id === remembered);
    setSelectedBrandId(stillExists ? remembered : data[0]?.id ?? null);
    setLoading(false);
  }, []);

  const loadProjects = useCallback(async (brandId: string) => {
    const res = await fetch(`/api/projects?brandId=${brandId}`);
    setProjects(await res.json());
  }, []);

  useEffect(() => {
    loadBrands();
  }, [loadBrands]);

  useEffect(() => {
    const ytConnected = searchParams.get("youtube_connected");
    const ytError = searchParams.get("youtube_error");
    const metaConnected = searchParams.get("meta_connected");
    const metaError = searchParams.get("meta_error");
    if (ytConnected) toast.success(`YouTube "${ytConnected}" tersambung`);
    if (ytError) toast.error(`Gagal sambungkan YouTube: ${ytError}`);
    if (metaConnected) toast.success(`Tersambung: ${metaConnected}`);
    if (metaError) toast.error(`Gagal sambungkan Meta: ${metaError}`);
    if (ytConnected || ytError || metaConnected || metaError) router.replace("/");
  }, [searchParams, router]);

  useEffect(() => {
    if (selectedBrandId) {
      localStorage.setItem(LAST_BRAND_KEY, selectedBrandId);
      loadProjects(selectedBrandId);
    }
  }, [selectedBrandId, loadProjects]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground">Memuat...</div>;
  }

  return (
    <div className="flex-1 flex flex-col">
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <h1 className="font-semibold text-lg">KontenPilot AI</h1>
        <Button variant="ghost" size="sm" onClick={handleLogout}>
          Keluar
        </Button>
      </header>

      <main className="flex-1 p-6 space-y-6 max-w-5xl w-full mx-auto">
        {brands.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Belum ada brand</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Buat brand pertama (mis. &quot;Pelangi Homestay&quot;) utk mulai kelola kontennya.
              </p>
              <NewBrandDialog onCreated={loadBrands} />
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <BrandSwitcher brands={brands} selectedBrandId={selectedBrandId} onSelect={setSelectedBrandId} />
                <NewBrandDialog onCreated={loadBrands} />
              </div>
              {selectedBrandId && <ContentIdeas brandId={selectedBrandId} onPickIdea={setPrefillScript} />}
              {selectedBrandId && <StoryboardDialog brandId={selectedBrandId} />}
              {selectedBrandId && <FootageBankDialog brandId={selectedBrandId} />}
              {selectedBrandId && (
                <AutoContentButton brandId={selectedBrandId} onDone={() => loadProjects(selectedBrandId)} />
              )}
              {selectedBrandId && (
                <NewProjectDialog
                  key={prefillScript ?? "default"}
                  brandId={selectedBrandId}
                  initialScript={prefillScript ?? undefined}
                  onCreated={() => {
                    loadProjects(selectedBrandId);
                    setPrefillScript(null);
                  }}
                />
              )}
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Konten</CardTitle>
              </CardHeader>
              <CardContent>
                <ProjectList projects={projects} />
              </CardContent>
            </Card>

            {selectedBrandId && <SocialAccounts brandId={selectedBrandId} />}
            {selectedBrandId && <AnalyticsSummary brandId={selectedBrandId} />}
          </>
        )}
      </main>
    </div>
  );
}
