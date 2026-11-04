// Tahap 4: kontrak VideoPlan. Fixture valid diterima, fixture rusak ditolak dgn kode yang tepat.
// Jalankan: npx tsx scripts/verify-videoplan.ts
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateVideoPlan, videoPlanPromptSpec, SCENE_TYPES } from "../src/lib/video/videoPlan";

type Broken = { name: string; expect: string; set?: Record<string, unknown>; setKey?: [string, string, unknown]; swap?: [number, number] };
type Fixture = { ctx: { footageIds: string[]; audioDurationSeconds: number }; valid: Record<string, unknown>; broken: Broken[] };
export const DOMAINS = ["hospitality", "laundry", "animal", "business"] as const;
export function loadFixture(d: string): Fixture {
  return JSON.parse(readFileSync(join(__dirname, "fixtures/videoplan", `${d}.json`), "utf8"));
}

const at = (o: unknown, path: string): { parent: Record<string, unknown>; key: string } => {
  const parts = path.split(".");
  let cur = o as Record<string, unknown>;
  for (const p of parts.slice(0, -1)) cur = cur[p] as Record<string, unknown>;
  return { parent: cur, key: parts[parts.length - 1] };
};
function mutate(f: Fixture, b: Broken) {
  const plan = structuredClone(f.valid);
  const ctx = { ...f.ctx };
  for (const [path, val] of Object.entries(b.set ?? {})) {
    if (path === "_audio") { ctx.audioDurationSeconds = val as number; continue; }
    const { parent, key } = at(plan, path); parent[key] = val;
  }
  if (b.setKey) { const [path, k, v] = b.setKey; const tgt = path ? (at(plan, path + ".x").parent) : plan; tgt[k] = v; }
  if (b.swap) { const s = plan.scenes as unknown[]; [s[b.swap[0]], s[b.swap[1]]] = [s[b.swap[1]], s[b.swap[0]]]; }
  return { plan, ctx };
}

let n = 0;
const ok = (m: string) => console.log(`  ok ${++n} - ${m}`);

if (require.main === module) {
  const seen = new Set<string>();
  for (const d of DOMAINS) {
    const f = loadFixture(d);
    const r = validateVideoPlan(f.valid, f.ctx);
    assert.ok(r.ok, `${d} valid harus lolos: ${!r.ok ? r.errors.join("; ") : ""}`);
    (f.valid.scenes as Array<{ type: string }>).forEach((s) => seen.add(s.type));
    for (const b of f.broken) {
      const { plan, ctx } = mutate(f, b);
      const rb = validateVideoPlan(plan, ctx);
      assert.ok(!rb.ok, `${d}/${b.name}: harus ditolak`);
      assert.ok(!rb.ok && rb.errors.some((e) => e.includes(b.expect)), `${d}/${b.name}: harus memuat "${b.expect}", dapat ${!rb.ok ? rb.errors.join("; ") : ""}`);
    }
    ok(`${d}: plan valid diterima; ${f.broken.length} plan rusak ditolak dgn kode tepat`);
  }
  assert.deepStrictEqual([...seen].sort(), [...SCENE_TYPES].sort(), "fixture mencakup 8 tipe adegan");
  ok("fixture mencakup 8 tipe adegan");

  // Tambahan: non-objek, scene di luar urutan, CTA ganda, before-after tanpa footage, chart rusak, maxScenes dari paket.
  const f = loadFixture("laundry");
  assert.ok(!validateVideoPlan("<html>", f.ctx).ok);
  assert.ok(!validateVideoPlan(null, f.ctx).ok);
  const two = structuredClone(f.valid) as { scenes: Array<Record<string, unknown>> };
  two.scenes.splice(1, 0, { id: "cta2", type: "cta", duration: 1, transition: "cut", text: "Hubungi kami" });
  const r2 = validateVideoPlan(two, { ...f.ctx, audioDurationSeconds: undefined });
  assert.ok(!r2.ok && r2.errors.some((e) => e.includes("max_one_cta")));
  const lo = structuredClone(f.valid) as { scenes: Array<Record<string, unknown>> };
  [lo.scenes[4], lo.scenes[5]] = [lo.scenes[5], lo.scenes[4]];
  const r3 = validateVideoPlan(lo, f.ctx);
  assert.ok(!r3.ok && r3.errors.some((e) => e.includes("logo_outro_only_last")));
  const ba = structuredClone(f.valid) as { scenes: Array<Record<string, unknown> & { after: Record<string, unknown> }> };
  delete ba.scenes[1].after.footageRef;
  const r4 = validateVideoPlan(ba, f.ctx);
  assert.ok(!r4.ok && r4.errors.some((e) => e.includes("after.footageRef: footage_ref_missing")));
  const ch = structuredClone(f.valid) as { scenes: Array<Record<string, unknown> & { after: Record<string, unknown> }> };
  ch.scenes[2].chart = [1, -5];
  assert.ok(!validateVideoPlan(ch, f.ctx).ok);
  const r5 = validateVideoPlan(f.valid, { ...f.ctx, maxScenes: 4 });
  assert.ok(!r5.ok && r5.errors.some((e) => e.includes("count(6 not in 3..4)")));
  for (const evil of ["onerror=alert(1)", "a{color:red}", "x` y", "&#60;b", "@import x", "javascript:alert(1)", "data:text/html,x"]) {
    const e = structuredClone(f.valid) as { scenes: Array<Record<string, unknown> & { after: Record<string, unknown> }> };
    e.scenes[0].text = evil;
    const re = validateVideoPlan(e, f.ctx);
    assert.ok(!re.ok && re.errors.some((x) => x.includes("markup_forbidden")), `tolak: ${evil}`);
  }
  ok("non-objek, CTA ganda, logo-outro bukan terakhir, before-after tanpa footage, chart negatif, batas adegan dari paket, 7 pola injeksi ditolak");

  // Deterministik: hasil sama utk input sama; validator tak mengubah input.
  const snap = JSON.stringify(f.valid);
  const a = JSON.stringify(validateVideoPlan(f.valid, f.ctx)), b = JSON.stringify(validateVideoPlan(f.valid, f.ctx));
  assert.strictEqual(a, b); assert.strictEqual(JSON.stringify(f.valid), snap);
  assert.ok(videoPlanPromptSpec().includes("footageRef HARUS dari daftar footage"));
  ok("deterministik, input tak dimutasi, spec prompt dibangun dari konstanta yg sama");
  console.log(`ALL_VIDEOPLAN_TESTS_PASS (${n} tes)`);
}
