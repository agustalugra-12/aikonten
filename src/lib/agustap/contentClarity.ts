import { getOpenAIClient } from "@/lib/ai/openaiClient";

// Content Clarity (PRD "Agustap Studio Content Clarity & Service Communication",
// 2026-09-02). Isolated Agustap-only module, dipanggil dari processProject.ts SETELAH
// generateCaptionAndHashtags (lihat wiring di sana) - REUSE bounded regen loop
// (MAX_REGEN_ATTEMPTS) yang SUDAH ADA di sana utk structure/hookType overused, bukan
// bikin retry-loop kedua. Guard aktivasi (isAgustapExtensionActive) dicek DI CALLER
// (processProject.ts), sama pola dgn generationStrategy.ts - modul ini sendiri TIDAK
// menyisipkan auth/guard.
//
// Kenapa perlu LLM (bukan regex spt prePublishQC.ts existing): "apakah orang awam paham
// ini jualan apa" inherently semantik, tidak bisa dicek deterministik. BUKAN pola "AI
// menilai AI" generik yang sengaja dihindari codebase ini (lihat Intent Coverage Score,
// web-pelangi) - output WAJIB terstruktur per-kriteria (sama pola dgn `benchmarksUsed`
// self-report di generationStrategy.ts yang terbukti reliable), dan precedent LANGSUNG
// sudah ada: web-pelangi's fact_check() adalah LLM checker terpisah utk draft LLM lain.

export type ServiceCatalog = {
  serviceDescription: string;
  packages: { name: string; price: string; features: string[] }[];
  commonFeatures: string[];
  addOns?: string[];
};

export type ClarityCheckInput = {
  caption: string;
  /** promotional_intensity dari content_types (0-100) - PRD §22: >=60 pakai bar promotional/package, di bawah itu bar educational. */
  promotionalIntensity: number;
};

export type ClarityCheckResult = {
  passed: boolean;
  topicClarity: boolean;
  serviceClarity: boolean;
  audienceClarity: boolean;
  benefitClarity: boolean;
  ctaClarity: boolean;
  languageSimplicity: boolean;
  jargonRisk: boolean;
  /** PRD §20 "apa yang dijual" test - null kalau tidak relevan (content educational). */
  whatIsSoldSentence: string | null;
  /** Alasan singkat kalau FAIL - dipakai sbg hint saat regenerate (PRD §23). */
  failureReason: string | null;
};

const PROMOTIONAL_THRESHOLD = 60;

function buildServiceIdentityBlock(catalog: ServiceCatalog): string {
  const packagesText = catalog.packages
    .map((p) => `- ${p.name}: ${p.price}/bulan — ${p.features.join(", ")}`)
    .join("\n");
  const addOnsText = catalog.addOns?.length ? `\nAdd-on: ${catalog.addOns.join(", ")}` : "";
  return (
    `Deskripsi layanan: ${catalog.serviceDescription}\n` +
    `Paket:\n${packagesText}\n` +
    `Semua paket termasuk: ${catalog.commonFeatures.join(", ")}${addOnsText}`
  );
}

/**
 * Satu panggilan LLM, output JSON terstruktur wajib per kriteria PRD §22. Content
 * educational (promotionalIntensity < 60) TIDAK butuh serviceCatalog - PRD §13
 * "educational tidak harus jualan", cukup topic/language clarity.
 */
export async function checkContentClarity(
  input: ClarityCheckInput,
  serviceCatalog: ServiceCatalog | null
): Promise<ClarityCheckResult> {
  const isPromotionalTier = input.promotionalIntensity >= PROMOTIONAL_THRESHOLD;
  const client = getOpenAIClient();

  const serviceBlock =
    isPromotionalTier && serviceCatalog
      ? buildServiceIdentityBlock(serviceCatalog)
      : null;

  // §20 - kalau promotional/package tapi TIDAK ADA source of truth layanan sama sekali,
  // tidak boleh menebak - langsung FAIL (bukan panggil LLM tanpa data nyata).
  if (isPromotionalTier && !serviceCatalog) {
    return {
      passed: false,
      topicClarity: false,
      serviceClarity: false,
      audienceClarity: false,
      benefitClarity: false,
      ctaClarity: false,
      languageSimplicity: false,
      jargonRisk: true,
      whatIsSoldSentence: null,
      failureReason: "Konten promotional/package tapi service_catalog brand kosong - tidak ada source of truth utk cek clarity.",
    };
  }

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content:
          "Kamu editor yang menilai apakah caption konten media sosial JELAS bagi orang awam " +
          "yang BELUM PERNAH dengar brand ini (Stranger Test, PRD §19). " +
          (isPromotionalTier
            ? "Ini konten PROMOTIONAL/PACKAGE - wajib jelas: layanan apa yang dijual, untuk " +
              "siapa, manfaatnya apa, cara dapatnya (CTA). Nama paket SENDIRIAN (mis. " +
              "'GROWTH', 'Rp1.800.000' tanpa konteks) TIDAK CUKUP - harus ada penjelasan " +
              "layanan sungguhan.\n\n" +
              `SOURCE OF TRUTH layanan (JANGAN anggap benar klaim di caption yang tidak cocok ini):\n${serviceBlock}`
            : "Ini konten EDUCATIONAL - TIDAK WAJIB jualan (PRD §13). Cukup nilai apakah " +
              "topik/masalah yang dibahas jelas & bahasanya sederhana, TIDAK PERLU serviceClarity."),
      },
      {
        role: "user",
        content:
          `Caption:\n"""${input.caption}"""\n\n` +
          "Balas HARUS JSON valid (tanpa markdown fence): " +
          '{"topicClarity": bool, "serviceClarity": bool, "audienceClarity": bool, ' +
          '"benefitClarity": bool, "ctaClarity": bool, "languageSimplicity": bool, ' +
          '"jargonRisk": bool, "whatIsSoldSentence": string|null, "failureReason": string|null}. ' +
          (isPromotionalTier
            ? "serviceClarity/audienceClarity/benefitClarity/ctaClarity WAJIB dinilai."
            : "serviceClarity/audienceClarity/benefitClarity/ctaClarity boleh true (tidak relevan utk educational)."),
      },
    ],
    temperature: 0.2,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "{}";
  const cleaned = raw.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
  const bool = (v: unknown): boolean => v === true;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Gagal parse -> anggap PASS (fail-open, §43 - jangan blokir generate krn masalah
    // parsing kita sendiri, bukan masalah kualitas konten).
    return {
      passed: true,
      topicClarity: true,
      serviceClarity: true,
      audienceClarity: true,
      benefitClarity: true,
      ctaClarity: true,
      languageSimplicity: true,
      jargonRisk: false,
      whatIsSoldSentence: null,
      failureReason: null,
    };
  }

  const topicClarity = bool(parsed.topicClarity);
  const languageSimplicity = bool(parsed.languageSimplicity);
  const serviceClarity = isPromotionalTier ? bool(parsed.serviceClarity) : true;
  const audienceClarity = isPromotionalTier ? bool(parsed.audienceClarity) : true;
  const benefitClarity = isPromotionalTier ? bool(parsed.benefitClarity) : true;
  const ctaClarity = isPromotionalTier ? bool(parsed.ctaClarity) : true;
  const jargonRisk = parsed.jargonRisk === true;

  // Minimum Pass Condition PRD §22.
  const passed = isPromotionalTier
    ? topicClarity && serviceClarity && benefitClarity && languageSimplicity && ctaClarity
    : topicClarity && languageSimplicity;

  return {
    passed,
    topicClarity,
    serviceClarity,
    audienceClarity,
    benefitClarity,
    ctaClarity,
    languageSimplicity,
    jargonRisk,
    whatIsSoldSentence: typeof parsed.whatIsSoldSentence === "string" ? parsed.whatIsSoldSentence : null,
    failureReason: typeof parsed.failureReason === "string" ? parsed.failureReason : null,
  };
}
