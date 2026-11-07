// AI Director VideoPlan (Tahap 5, mode BAYANGAN). Dari brief + naskah + Brand Kit + kandidat footage +
// paket -> VideoPlan JSON tervalidasi. Mode shadow (flag VIDEOPLAN_SHADOW_ENABLED=1, default OFF) hanya
// MENCATAT plan + hasil validasi + latency + biaya ke JSONL; video pelanggan tetap dari jalur lama.
// Tak pernah melempar error ke pipeline: AI gagal / plan invalid -> dicatat, jalur lama jalan apa adanya.
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { validateVideoPlan, videoPlanPromptSpec, LIMITS, type VideoPlan } from "./videoPlan";

export const DIRECTOR_MODEL = "gpt-4.1-mini";
const PRICE_PER_1M: [number, number] = [0.40, 1.60]; // = openaiClient MODEL_PRICING_PER_1M["gpt-4.1-mini"]

export type FootageCandidate = { id: string; label: string; durationSeconds: number; source: "brand" | "stock" };
export type DirectorInput = {
  projectId: string;
  brandName: string;
  brief: string;               // ide/angle konten
  script: string;              // naskah VO
  hookText?: string | null;
  orientation: "portrait" | "landscape" | "square";
  brandLook?: string | null;   // brandKit.look (menang) - AI tetap boleh usul, builder pakai brandKit
  footage: FootageCandidate[];
  audioDurationSeconds: number;
  internal: boolean;           // owner unlimited -> plafon adegan lebih tinggi
};
export type Completion = { text: string; promptTokens: number; completionTokens: number };
export type CompleteFn = (system: string, user: string) => Promise<Completion>;
export type DirectorResult = {
  ok: boolean;
  plan: VideoPlan | null;
  errors: string[];            // kode validasi / "ai_error: ..." / "json_parse"
  attempts: number;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
};

export const maxScenesFor = (internal: boolean) => (internal ? 12 : 8);

/** Rentang total durasi adegan yang AKAN diterima validator, dihitung dari durasi VO.
 *  Validator memakai target = durasiVO + durasi hook, toleransi maks(2, 25%), lalu
 *  total tetap wajib di dalam LIMITS.totalSeconds. Dulu prompt hanya menyebut rumusnya
 *  ("≈ durasi VO + hook") - AI tetap meleset 11x. Sekarang ANGKA JADI-nya yang dikirim.
 *  CATATAN: untuk audio sangat panjang (long-form), batas atas LIMITS.totalSeconds.max
 *  membuat rentang ini MUSTAHIL dipenuhi - itu batas kontrak, bukan kesalahan prompt. */
export function targetTotalDetik(audioDurationSeconds: number): { min: number; max: number; takTercapai: boolean } {
  // Validator: |total - (durasiVO + durasiHook)| <= maks(2, (durasiVO+durasiHook)*0.25),
  // dengan durasiHook yang DIPILIH AI (LIMITS.hookSeconds). Rentang yang kita iklankan
  // harus diterima untuk durasi hook MANA PUN, jadi dipakai IRISAN semua jendela itu:
  //   batas bawah = jendela dgn hook TERPANJANG  (target terbesar -> tepi bawah tertinggi)
  //   batas atas  = jendela dgn hook TERPENDEK   (target terkecil -> tepi atas terendah)
  // Dulu prompt hanya menyebut rumusnya ("~ durasi VO + hook") dan AI meleset 11x;
  // iklan 25% penuh juga masih bisa keluar jendela (terbukti 22.0s vs 16.6s).
  const jendela = (hook: number) => {
    const target = audioDurationSeconds + hook;
    const tol = Math.max(2, target * 0.25);
    return { bawah: target - tol, atas: target + tol };
  };
  // Dibulatkan KE DALAM (bawah naik, atas turun). Math.round biasa bisa mendorong tepi
  // atas keluar jendela sampai 0,05 dtk (mis. 57,75 -> 57,8) dan rencana jadi ditolak.
  const keAtas = (x: number) => Math.ceil(x * 10) / 10;
  const keBawah = (x: number) => Math.floor(x * 10) / 10;
  const bawahKetat = jendela(LIMITS.hookSeconds.max).bawah;
  const atasKetat = jendela(LIMITS.hookSeconds.min).atas;
  // Kedua ujung dijepit ke LIMITS.totalSeconds: untuk audio sangat pendek, irisan jendela
  // bisa jatuh DI BAWAH total minimum - rentang yang diiklankan tak boleh keluar kontrak.
  const jepit = (x: number) => Math.min(Math.max(x, LIMITS.totalSeconds.min), LIMITS.totalSeconds.max);
  // Dirapatkan 0,05 dtk ke dalam: tepat DI tepi jendela, galat pembulatan desimal bisa
  // membuat |total-target| sedikit melebihi toleransi (2.3000000000000007 > 2.3) dan
  // rencana yang sebenarnya pas malah ditolak.
  // Urutan penting: rapatkan dulu terhadap JENDELA VALIDATOR, baru dijepit ke batas
  // kontrak. Kalau dibalik, epsilon malah menggeser hasil keluar LIMITS.totalSeconds.
  const EPS = 0.05;
  const min = jepit(keAtas(bawahKetat + EPS));
  const max = jepit(keBawah(atasKetat - EPS));
  return { min: Math.min(min, max), max: Math.max(min, max), takTercapai: bawahKetat > LIMITS.totalSeconds.max };
}

export function directorPrompts(i: DirectorInput, prevErrors?: string[]): { system: string; user: string } {
  const system = [
    "Kamu sutradara video pendek media sosial. Susun rencana adegan sebagai JSON VideoPlan.",
    "Pilih struktur yang paling cocok dengan naskah; jangan pakai urutan yang sama untuk semua video.",
    "Hook = 3 detik pertama, pakai footage paling relevan & menarik. Teks di layar singkat dan diambil dari naskah.",
    "Jangan mengarang angka, harga, atau testimoni yang tidak ada di naskah/brief. Kalau tidak ada, jangan pakai adegan stat/testimonial.",
    "Sebelum membalas, periksa sendiri: (1) tiap adegan memakai field DATAR sesuai daftar, tidak ada objek bernama tipe; (2) tiap teks di bawah batas karakter DAN kata; (3) jumlah semua duration masuk totalTargetDetik.",
    "Balas HANYA JSON.",
    videoPlanPromptSpec(),
  ].join("\n");
  const user = JSON.stringify({
    brand: i.brandName, brief: i.brief.slice(0, 600), naskah: i.script.slice(0, 2000), hook: i.hookText || undefined,
    orientation: i.orientation, lookBrand: i.brandLook || undefined, durasiVO: Math.round(i.audioDurationSeconds * 10) / 10,
    // Rentang JADI, bukan rumus - inilah yang diperiksa validator (lihat targetTotalDetik).
    totalTargetDetik: targetTotalDetik(i.audioDurationSeconds),
    maksAdegan: maxScenesFor(i.internal),
    footage: i.footage.slice(0, 24).map((f) => ({ id: f.id, isi: f.label.slice(0, 80), durasi: Math.round(f.durationSeconds * 10) / 10 })),
    ...(prevErrors?.length ? { perbaiki: prevErrors.slice(0, 12) } : {}),
  });
  return { system, user };
}

async function defaultComplete(system: string, user: string): Promise<Completion> {
  const { getOpenAIClient } = await import("@/lib/ai/openaiClient");
  const r = await getOpenAIClient().chat.completions.create({
    model: DIRECTOR_MODEL, temperature: 0.5, response_format: { type: "json_object" }, max_tokens: 1500,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
  });
  return { text: r.choices[0]?.message?.content || "", promptTokens: r.usage?.prompt_tokens ?? 0, completionTokens: r.usage?.completion_tokens ?? 0 };
}

// Maks 2 percobaan: ke-2 hanya bila JSON terbaca tapi gagal validasi (kirim daftar error utk diperbaiki).
export async function generateVideoPlan(i: DirectorInput, complete: CompleteFn = defaultComplete, now: () => number = Date.now): Promise<DirectorResult> {
  const t0 = now();
  const res: DirectorResult = { ok: false, plan: null, errors: [], attempts: 0, latencyMs: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 };
  const ctx = { footageIds: i.footage.map((f) => f.id), audioDurationSeconds: i.audioDurationSeconds, maxScenes: maxScenesFor(i.internal) };
  let prev: string[] | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    res.attempts = attempt;
    const { system, user } = directorPrompts(i, prev);
    let c: Completion;
    try { c = await complete(system, user); } catch (e) { res.errors = [`ai_error: ${String((e as Error)?.message || e).slice(0, 160)}`]; break; }
    res.promptTokens += c.promptTokens; res.completionTokens += c.completionTokens;
    let parsed: unknown;
    try { parsed = JSON.parse(c.text); } catch { res.errors = ["json_parse"]; break; }
    const v = validateVideoPlan(parsed, ctx);
    if (v.ok) { res.ok = true; res.plan = v.plan; res.errors = []; break; }
    res.errors = v.errors; prev = v.errors;
  }
  res.latencyMs = now() - t0;
  res.costUsd = (res.promptTokens / 1e6) * PRICE_PER_1M[0] + (res.completionTokens / 1e6) * PRICE_PER_1M[1];
  return res;
}

export const shadowEnabled = (env: Record<string, string | undefined> = process.env) => env.VIDEOPLAN_SHADOW_ENABLED === "1";
export const shadowLogPath = (env: Record<string, string | undefined> = process.env) => env.VIDEOPLAN_SHADOW_LOG || "data/videoplan-shadow.jsonl";

// Dipanggil pipeline TANPA await (void). Flag OFF -> langsung return null, 0 call AI. Tak pernah throw.
export async function runVideoPlanShadow(i: DirectorInput, opts: { complete?: CompleteFn; env?: Record<string, string | undefined> } = {}): Promise<DirectorResult | null> {
  const env = opts.env ?? process.env;
  if (!shadowEnabled(env)) return null;
  try {
    const r = await generateVideoPlan(i, opts.complete);
    const rec = { ts: new Date().toISOString(), projectId: i.projectId, brand: i.brandName, internal: i.internal, footage: i.footage.length, audio: i.audioDurationSeconds, ...r };
    const path = shadowLogPath(env);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, JSON.stringify(rec) + "\n");
    return r;
  } catch (e) {
    console.error("[videoPlanShadow] diabaikan:", String((e as Error)?.message || e));
    return null;
  }
}

// Ringkasan metrik dari JSONL shadow: tingkat lolos, alasan gagal teratas, latency p50/p95, biaya.
export function summarizeShadow(lines: string[]) {
  const recs = lines.filter(Boolean).map((l) => JSON.parse(l) as DirectorResult);
  const pass = recs.filter((r) => r.ok).length;
  const reasons = new Map<string, number>();
  for (const r of recs) for (const e of r.errors) { const k = e.replace(/\[\d+\]/g, "[]").replace(/\(.*\)$/, ""); reasons.set(k, (reasons.get(k) ?? 0) + 1); }
  const lat = recs.map((r) => r.latencyMs).sort((a, b) => a - b);
  const q = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] : 0);
  const cost = recs.reduce((a, r) => a + r.costUsd, 0);
  return {
    total: recs.length, pass, passRate: recs.length ? pass / recs.length : 0,
    firstTryPass: recs.filter((r) => r.ok && r.attempts === 1).length,
    topReasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
    latencyP50: q(0.5), latencyP95: q(0.95), costTotalUsd: cost, costPerPlanUsd: recs.length ? cost / recs.length : 0,
  };
}
