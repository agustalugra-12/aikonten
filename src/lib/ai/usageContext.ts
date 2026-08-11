import { AsyncLocalStorage } from "node:async_hooks";

// Atribusi biaya per-brand/per-video (2026-08-12, Fase 1a PRD Animal Story & Co "100
// video/30 hari") - llm_usage_log SEBELUM ini genuinely tidak bisa diatribusikan ke
// brand/project manapun (dicek langsung: tidak ada kolom brand_id/project_id, tidak ada
// tabel lain yang simpan referensi balik ke baris usage log). Ini prasyarat cost
// dashboard per-brand (PRD section 38) & budget protection (section 25).
//
// Pakai AsyncLocalStorage (bukan meneruskan brandId/projectId manual ke ~20 titik
// panggil model yang sudah hardcode "gpt-4.1-mini" tersebar di banyak file) - satu kali
// bungkus di titik ENTRY (processProject/getOrGenerateDailyIdeas), otomatis "ikut" ke
// semua panggilan async di bawahnya tanpa ubah signature fungsi manapun. Dibaca cuma di
// SATU titik (openaiClient.ts logOpenAIUsage/logNonTokenUsage) - konsisten dgn pola
// "centralize once, jangan tambal 20 file" yang sudah jadi filosofi file itu sendiri.
type UsageContext = { brandId: string; projectId?: string };

const storage = new AsyncLocalStorage<UsageContext>();

export function runWithUsageContext<T>(ctx: UsageContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

export function getCurrentUsageContext(): UsageContext | undefined {
  return storage.getStore();
}
