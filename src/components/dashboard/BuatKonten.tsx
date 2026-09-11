"use client";

import { Card, CardContent } from "@/components/ui/card";
import { AutoContentButton } from "@/components/dashboard/AutoContentButton";
import { NewProjectDialog } from "@/components/dashboard/NewProjectDialog";
import { ContentIdeas } from "@/components/dashboard/ContentIdeas";
import { DailyContentPlanner } from "@/components/dashboard/DailyContentPlanner";
import { Sparkles, Lightbulb, PenLine } from "lucide-react";
import type { Brand } from "@/types";

// Halaman "Buat Konten" terpadu (2026-09-11, redesign UI mockup KontenPilot). Mockup
// yg diberikan Agus TIDAK menyertakan desain halaman ini - jadi ini konsolidasi 3
// mekanisme pembuatan yg SUDAH ADA & jalan (Otomatis-AI / Dari Ide / Manual) ke satu
// tempat bergaya kartu, BUKAN mesin baru. Tiap kartu cuma membungkus komponen trigger
// yg sudah ada (AutoContentButton/ContentIdeas/DailyContentPlanner/NewProjectDialog) -
// logika generate tidak disentuh sama sekali. Tema tetap token shadcn monokrom.
export function BuatKonten({
  brandId,
  brand,
  onRefresh,
  onPickIdea,
}: {
  brandId: string;
  brand: Brand | null;
  onRefresh: () => void;
  // Dipetakan ke setPrefillScript/setPrefillType di page.tsx - memilih ide mengisi
  // dialog "Buat Manual" di header (perilaku sama spt view "Ide" sebelumnya).
  onPickIdea: (script: string, type?: "video" | "carousel" | "foto") => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Buat Konten</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Pilih cara membuat konten untuk {brand?.name || "brand ini"}.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {/* 1. Otomatis (AI) */}
        <Card className="flex flex-col">
          <CardContent className="p-5 flex flex-col flex-1 gap-3">
            <div className="w-10 h-10 rounded-lg bg-foreground text-background flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <p className="font-medium">Buat Otomatis (AI)</p>
              <p className="text-sm text-muted-foreground mt-1">
                AI memilih ide terbaik & menghasilkan konten lengkap sendiri sesuai target harian brand.
              </p>
            </div>
            <div>
              <AutoContentButton brandId={brandId} brand={brand} onDone={onRefresh} />
            </div>
          </CardContent>
        </Card>

        {/* 2. Dari Ide */}
        <Card className="flex flex-col">
          <CardContent className="p-5 flex flex-col flex-1 gap-3">
            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
              <Lightbulb className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <p className="font-medium">Dari Ide</p>
              <p className="text-sm text-muted-foreground mt-1">
                Pilih dari rencana harian atau cari ide dari topik/kata kunci — lalu lanjut ke pembuatan.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <DailyContentPlanner brandId={brandId} onPickIdea={onPickIdea} />
              <ContentIdeas brandId={brandId} onPickIdea={(script) => onPickIdea(script)} />
            </div>
          </CardContent>
        </Card>

        {/* 3. Manual */}
        <Card className="flex flex-col">
          <CardContent className="p-5 flex flex-col flex-1 gap-3">
            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
              <PenLine className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <p className="font-medium">Manual</p>
              <p className="text-sm text-muted-foreground mt-1">
                Tulis skrip/brief sendiri atau unggah footage — kontrol penuh atas kontennya.
              </p>
            </div>
            <div>
              <NewProjectDialog
                brandId={brandId}
                carouselPhotosPerPost={brand?.carouselPhotosPerPost ?? 5}
                onCreated={onRefresh}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
