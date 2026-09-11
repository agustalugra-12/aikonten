"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BrandSwitcher } from "@/components/dashboard/BrandSwitcher";
import { NewBrandDialog } from "@/components/dashboard/NewBrandDialog";
import { NewProjectDialog } from "@/components/dashboard/NewProjectDialog";
import { ProjectList } from "@/components/dashboard/ProjectList";
import { DraftReview } from "@/components/dashboard/DraftReview";
import { SocialAccounts } from "@/components/dashboard/SocialAccounts";
import { AnalyticsSummary } from "@/components/dashboard/AnalyticsSummary";
import { WeeklyReport } from "@/components/dashboard/WeeklyReport";
import { ContentPlan } from "@/components/dashboard/ContentPlan";
import { FatigueSummary } from "@/components/dashboard/FatigueSummary";
import { CompetitorIntelligence } from "@/components/dashboard/CompetitorIntelligence";
import { AgustapIntelligence } from "@/components/dashboard/AgustapIntelligence";
import { MonthlyReport } from "@/components/dashboard/MonthlyReport";
import { UsageSummary } from "@/components/dashboard/UsageSummary";
import { ContentIdeas } from "@/components/dashboard/ContentIdeas";
import { DailyContentPlanner } from "@/components/dashboard/DailyContentPlanner";
import { StoryboardDialog } from "@/components/dashboard/StoryboardDialog";
import { MusicBankDialog } from "@/components/dashboard/MusicBankDialog";
import { BrandSettingsSidebar } from "@/components/dashboard/BrandSettingsSidebar";
import { AutoContentButton } from "@/components/dashboard/AutoContentButton";
import { BuatKonten } from "@/components/dashboard/BuatKonten";
import { LibraryFootage } from "@/components/dashboard/LibraryFootage";
import { Sidebar, type DashboardView } from "@/components/dashboard/Sidebar";
import { DashboardOverview } from "@/components/dashboard/DashboardOverview";
import { toast } from "sonner";
import type { Brand, Project, SocialAccount } from "@/types";

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
  // Akun sosmed brand terpilih (2026-08-13, dibutuhkan ProjectList.tsx utk ikon
  // platform tujuan) - fetch terpisah dari yg sudah ada di SocialAccounts.tsx/
  // DraftReview.tsx (masing2 komponen py fetch sendiri, pola yg sudah dipakai di file
  // ini - bukan refactor arsitektur data baru).
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  // Sidebar navigasi (2026-08-13, permintaan Agus - konsep dashboard baru gaya app
  // musik) - switch VIEW client-side, BUKAN routing Next.js baru (lihat Sidebar.tsx).
  const [activeView, setActiveView] = useState<DashboardView>("overview");
  const [laporanTab, setLaporanTab] = useState<"mingguan" | "bulanan">("mingguan");
  // Diisi kalau Agus klik salah satu "Ide Konten"/Content Planner - lihat
  // ContentIdeas.tsx/DailyContentPlanner.tsx. Dipakai sbg `key` remount
  // NewProjectDialog di bawah biar initialScript-nya benar2 baru.
  const [prefillScript, setPrefillScript] = useState<string | null>(null);
  // Diisi dari Content Planner harian (2026-08-05, permintaan Agus - "4 foto 4 video 4
  // carousel") - tipe yg AI sarankan utk ide yg dipilih. "Ide Konten" lama tidak pernah
  // isi ini (selalu undefined), NewProjectDialog default ke "video" spt biasa.
  const [prefillType, setPrefillType] = useState<"video" | "foto" | "carousel" | undefined>(undefined);

  async function loadBrands() {
    const res = await fetch("/api/brands");
    const data: Brand[] = await res.json();
    setBrands(data);
    const remembered = typeof window !== "undefined" ? localStorage.getItem(LAST_BRAND_KEY) : null;
    const stillExists = remembered && data.some((b) => b.id === remembered);
    setSelectedBrandId(stillExists ? remembered : data[0]?.id ?? null);
    setLoading(false);
  }

  async function loadProjects(brandId: string) {
    const res = await fetch(`/api/projects?brandId=${brandId}`);
    setProjects(await res.json());
  }

  useEffect(() => {
    fetch("/api/brands")
      .then((res) => res.json())
      .then((data: Brand[]) => {
        setBrands(data);
        const remembered = typeof window !== "undefined" ? localStorage.getItem(LAST_BRAND_KEY) : null;
        const stillExists = remembered && data.some((b) => b.id === remembered);
        setSelectedBrandId(stillExists ? remembered : data[0]?.id ?? null);
        setLoading(false);
      });
  }, []);

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
    if (!selectedBrandId) return;
    localStorage.setItem(LAST_BRAND_KEY, selectedBrandId);
    fetch(`/api/projects?brandId=${selectedBrandId}`).then((res) => res.json()).then(setProjects);
    fetch(`/api/brands/${selectedBrandId}/social-accounts`)
      .then((res) => (res.ok ? res.json() : []))
      .then(setAccounts);
  }, [selectedBrandId]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground">Memuat...</div>;
  }

  if (brands.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
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
      </div>
    );
  }

  const currentBrand = brands.find((b) => b.id === selectedBrandId) ?? null;
  const refreshProjects = () => selectedBrandId && loadProjects(selectedBrandId);

  return (
    <div className="flex-1 flex min-h-0">
      <Sidebar brand={currentBrand} activeView={activeView} onSelectView={setActiveView} />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 border-b bg-card px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BrandSwitcher brands={brands} selectedBrandId={selectedBrandId} onSelect={setSelectedBrandId} />
            <NewBrandDialog onCreated={loadBrands} />
          </div>
          <div className="flex items-center gap-2">
            {selectedBrandId && (
              <NewProjectDialog
                key={prefillScript ?? "default"}
                brandId={selectedBrandId}
                initialScript={prefillScript ?? undefined}
                initialType={prefillType}
                carouselPhotosPerPost={currentBrand?.carouselPhotosPerPost ?? 5}
                onCreated={() => {
                  refreshProjects();
                  setPrefillScript(null);
                  setPrefillType(undefined);
                  setActiveView("konten");
                }}
              />
            )}
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              Keluar
            </Button>
          </div>
        </header>

        <main className="flex-1 p-6 max-w-5xl w-full mx-auto overflow-y-auto">
          {!selectedBrandId ? null : activeView === "overview" ? (
            <DashboardOverview brand={currentBrand} projects={projects} accounts={accounts} onRetryProject={refreshProjects} />
          ) : activeView === "buat" ? (
            <BuatKonten
              brandId={selectedBrandId}
              brand={currentBrand}
              onRefresh={refreshProjects}
              onPickIdea={(script, type) => {
                setPrefillScript(script);
                setPrefillType(type);
              }}
            />
          ) : activeView === "konten" ? (
            <div className="space-y-6">
              <div className="flex items-center gap-2 flex-wrap">
                <AutoContentButton brandId={selectedBrandId} brand={currentBrand} onDone={refreshProjects} />
                <StoryboardDialog brandId={selectedBrandId} />
              </div>

              <UsageSummary />
              <AnalyticsSummary brandId={selectedBrandId} />
              <FatigueSummary brandId={selectedBrandId} />
              <DraftReview brandId={selectedBrandId} projects={projects} onChange={refreshProjects} />

              <Card>
                <CardHeader>
                  <CardTitle>Semua Konten</CardTitle>
                </CardHeader>
                <CardContent>
                  <ProjectList projects={projects} brand={currentBrand} accounts={accounts} onRetry={refreshProjects} />
                </CardContent>
              </Card>

              <SocialAccounts brandId={selectedBrandId} />
            </div>
          ) : activeView === "ide" ? (
            <div className="space-y-4">
              <Card>
                <CardContent className="p-6 flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="font-medium">Rencana Konten Harian</p>
                    <p className="text-sm text-muted-foreground">Saran jadwal ide berdasarkan target harian brand ini.</p>
                  </div>
                  <DailyContentPlanner
                    brandId={selectedBrandId}
                    onPickIdea={(script, type) => {
                      setPrefillScript(script);
                      setPrefillType(type);
                    }}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6 flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="font-medium">Ide Konten</p>
                    <p className="text-sm text-muted-foreground">Cari ide dari topik/kata kunci bebas.</p>
                  </div>
                  <ContentIdeas brandId={selectedBrandId} onPickIdea={setPrefillScript} />
                </CardContent>
              </Card>
            </div>
          ) : activeView === "rencana" ? (
            <ContentPlan brandId={selectedBrandId} />
          ) : activeView === "kompetitor" ? (
            <CompetitorIntelligence brandId={selectedBrandId} />
          ) : activeView === "agustap" ? (
            <AgustapIntelligence brandId={selectedBrandId} />
          ) : activeView === "footage" ? (
            <LibraryFootage brandId={selectedBrandId} />
          ) : activeView === "musik" ? (
            <Card>
              <CardContent className="p-6 flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <p className="font-medium">Music Bank</p>
                  <p className="text-sm text-muted-foreground">Kelola koleksi musik latar brand ini.</p>
                </div>
                <MusicBankDialog brandId={selectedBrandId} />
              </CardContent>
            </Card>
          ) : activeView === "laporan" ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Button variant={laporanTab === "mingguan" ? "default" : "outline"} size="sm" onClick={() => setLaporanTab("mingguan")}>
                  Laporan Mingguan
                </Button>
                <Button variant={laporanTab === "bulanan" ? "default" : "outline"} size="sm" onClick={() => setLaporanTab("bulanan")}>
                  Laporan Bulanan
                </Button>
              </div>
              {laporanTab === "mingguan" ? (
                <WeeklyReport brandId={selectedBrandId} />
              ) : (
                <MonthlyReport brandId={selectedBrandId} />
              )}
            </div>
          ) : (
            <Card>
              <CardContent className="p-6 flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <p className="font-medium">Pengaturan Brand</p>
                  <p className="text-sm text-muted-foreground">Profil desain, knowledge, jadwal auto-publish, dst.</p>
                </div>
                <BrandSettingsSidebar brandId={selectedBrandId} brand={currentBrand} onChanged={loadBrands} />
              </CardContent>
            </Card>
          )}
        </main>
      </div>
    </div>
  );
}
