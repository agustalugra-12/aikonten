// Tahap 5: AI Director mode bayangan. AI TIRUAN (tanpa biaya API): 24 brief dari 4 domain dgn respons
// campuran (valid, perlu perbaikan, rusak, JSON jelek, AI error). Cek: flag OFF = 0 call; shadow tak pernah
// throw; plan invalid tak lolos; metrik lolos/alasan/latency/biaya tercatat; jalur lama tak disentuh.
// Jalankan: npx tsx scripts/verify-videoplan-shadow.ts
import assert from "node:assert";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateVideoPlan, runVideoPlanShadow, summarizeShadow, directorPrompts, type CompleteFn, type DirectorInput } from "../src/lib/video/videoPlanDirector";
import { loadFixture, DOMAINS } from "./verify-videoplan";

let n = 0;
const ok = (m: string) => console.log(`  ok ${++n} - ${m}`);

function inputFor(domain: string, k: number): DirectorInput {
  const f = loadFixture(domain);
  return {
    projectId: `p-${domain}-${k}`, brandName: domain, brief: `brief ${domain} ${k}`, script: `naskah ${domain} ${k}`,
    hookText: null, orientation: "portrait", brandLook: null, audioDurationSeconds: f.ctx.audioDurationSeconds, internal: k % 2 === 0,
    footage: f.ctx.footageIds.map((id) => ({ id, label: id.replace(/-/g, " "), durationSeconds: 6, source: "brand" as const })),
  };
}
// Skenario respons AI tiruan per indeks: 0 valid, 1 invalid->diperbaiki, 2 invalid 2x, 3 JSON jelek, 4 AI error, 5 valid.
function fakeAI(domain: string, k: number): { complete: CompleteFn; calls: () => number } {
  const valid = loadFixture(domain).valid;
  const bad = { ...structuredClone(valid), html: "<div/>" };
  let calls = 0;
  const complete: CompleteFn = async (_s, user) => {
    calls++;
    const fix = JSON.parse(user).perbaiki;
    const kind = k % 6;
    const usage = { promptTokens: 1800, completionTokens: 450 };
    if (kind === 4) throw new Error("429 rate limit");
    if (kind === 3) return { text: "{rusak", ...usage };
    if (kind === 1) return { text: JSON.stringify(fix ? valid : bad), ...usage };
    if (kind === 2) return { text: JSON.stringify(bad), ...usage };
    return { text: JSON.stringify(valid), ...usage };
  };
  return { complete, calls: () => calls };
}

(async () => {
  const dir = mkdtempSync(join(tmpdir(), "vpshadow-"));
  const log = join(dir, "shadow.jsonl");

  // 1. Flag OFF (default): 0 call AI, tak menulis log, return null.
  const offAI = fakeAI("laundry", 0);
  assert.strictEqual(await runVideoPlanShadow(inputFor("laundry", 0), { complete: offAI.complete, env: { VIDEOPLAN_SHADOW_LOG: log } }), null);
  assert.strictEqual(offAI.calls(), 0); assert.ok(!existsSync(log));
  ok("flag OFF (default): 0 call AI, tanpa log, return null");

  // 2. 24 plan (6 per domain) lewat shadow ON dgn AI tiruan.
  const env = { VIDEOPLAN_SHADOW_ENABLED: "1", VIDEOPLAN_SHADOW_LOG: log };
  const results = [];
  for (const d of DOMAINS) for (let k = 0; k < 6; k++) {
    const ai = fakeAI(d, k);
    const r = await runVideoPlanShadow(inputFor(d, k), { complete: ai.complete, env });
    assert.ok(r, "shadow ON harus mengembalikan hasil (tak throw)");
    results.push({ k, r, calls: ai.calls() });
  }
  for (const { k, r, calls } of results) {
    const kind = k % 6;
    if (kind === 0 || kind === 5) { assert.ok(r!.ok && r!.attempts === 1 && calls === 1); }
    if (kind === 1) { assert.ok(r!.ok && r!.attempts === 2 && calls === 2, "invalid -> 1x perbaikan -> lolos"); }
    if (kind === 2) { assert.ok(!r!.ok && r!.plan === null && calls === 2 && r!.errors.some((e) => e.includes("unknown_field"))); }
    if (kind === 3) { assert.ok(!r!.ok && calls === 1 && r!.errors[0] === "json_parse"); }
    if (kind === 4) { assert.ok(!r!.ok && calls === 1 && r!.errors[0].startsWith("ai_error")); }
    assert.ok(calls <= 2, "maks 2 call AI per video");
  }
  ok("24 plan: valid lolos 1x; invalid diperbaiki maks 1x; rusak/JSON jelek/AI error -> ok=false, plan=null, maks 2 call");

  // 3. Metrik dari JSONL.
  const lines = readFileSync(log, "utf8").trim().split("\n");
  assert.strictEqual(lines.length, 24);
  const s = summarizeShadow(lines);
  assert.strictEqual(s.total, 24); assert.strictEqual(s.pass, 12); assert.strictEqual(s.firstTryPass, 8);
  assert.ok(s.topReasons.some(([k]) => k.includes("unknown_field")) && s.topReasons.some(([k]) => k === "json_parse") && s.topReasons.some(([k]) => k.startsWith("ai_error")));
  assert.ok(s.costTotalUsd > 0 && Math.abs(s.costPerPlanUsd - s.costTotalUsd / 24) < 1e-12);
  const rec = JSON.parse(lines[0]);
  for (const k of ["ts", "projectId", "ok", "errors", "attempts", "latencyMs", "promptTokens", "completionTokens", "costUsd", "plan"]) assert.ok(k in rec, `log punya ${k}`);
  console.log(`     metrik: lolos ${s.pass}/${s.total} (${Math.round(s.passRate * 100)}%), 1x-lolos ${s.firstTryPass}, biaya/plan $${s.costPerPlanUsd.toFixed(5)}, alasan: ${s.topReasons.map(([k, v]) => `${k}×${v}`).join(", ")}`);
  ok("JSONL: tingkat lolos, alasan gagal, latency p50/p95, biaya per plan tercatat");

  // 4. Biaya dihitung dari token (gpt-4.1-mini $0.40/$1.60 per 1M).
  const one = await generateVideoPlan(inputFor("animal", 0), fakeAI("animal", 0).complete);
  assert.ok(Math.abs(one.costUsd - (1800 * 0.4 + 450 * 1.6) / 1e6) < 1e-12);
  ok(`biaya per plan dari token: $${one.costUsd.toFixed(5)} (1 call)`);

  // 5. Prompt: footage terbatas & plafon adegan dari paket; tak ada URL footage dikirim ke AI.
  const pin = inputFor("hospitality", 1);
  pin.footage[0].label = "kolam https://cdn.example/x.mp4";
  const { user, system } = directorPrompts(pin);
  const u = JSON.parse(user);
  assert.strictEqual(u.maksAdegan, 8); assert.strictEqual(JSON.parse(directorPrompts(inputFor("hospitality", 0)).user).maksAdegan, 12);
  assert.ok(!("videoUrl" in u.footage[0]) && system.includes("Jangan mengarang angka"));
  ok("prompt: plafon adegan eksternal 8 / internal 12, footage hanya id+isi+durasi, larangan mengarang angka/testimoni");

  // 6. Wiring pipeline: dipanggil tanpa await & dijaga flag; jalur render lama tak diubah.
  const src = readFileSync(join(__dirname, "../src/lib/pipeline/processProject.ts"), "utf8");
  assert.ok(/if \(shadowEnabled\(\) && !isScenesEngine\)/.test(src) && /void getAudioDurationSeconds\(voiceoverBuffer\)\.then/.test(src));
  assert.ok(!/await runVideoPlanShadow/.test(src), "shadow tak boleh di-await di pipeline");
  ok("pipeline: shadow di belakang flag, tanpa await (render & durasi lama tak menunggu/berubah)");
  console.log(`ALL_VIDEOPLAN_SHADOW_TESTS_PASS (${n} tes)`);
})().catch((e) => { console.error(e); process.exit(1); });
