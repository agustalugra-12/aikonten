// Motion Pack 1 (2026-11-06) - verifikasi registry motion HyperFrames (GSAP).
// Jalankan: npx tsx scripts/verify-motion-pack-1.ts
// Cakupan: (a) snapshot per-motion stabil utk opts tetap; (b) intensitas ubah output (low!=high);
// (c) pack-disabled -> buildComposition byte-identik baseline (golden + omit==undefined);
// (d) premium vs playful beda fragmen/kombinasi; (e) KONTRAK - tak ada .play/.pause/.seek/
// .currentTime/playbackRate & tak ada data-motion-blur="on".
import assert from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  punchIn, whipPan, flash, textReveal, countUp, lowerThirdInOut,
  resolveMotionPackConfig, resolveMotionTone, isMotionTone, isMotionId,
  TONE_CONFIGS, MOTION_IDS, MOTION_COST, DEFAULT_MOTION_TONE,
} from "../src/lib/render/motionPack";
import { buildComposition } from "../src/lib/render/hyperframesComposition";
import { validateBrandKit, resolveBrandKit } from "../src/lib/render/brandKit";
import { GOLDEN_INPUTS } from "./hf-golden-inputs";

let n = 0;
const ok = (m: string) => console.log(`  ok ${++n} - ${m}`);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const FORBIDDEN = [".play(", ".pause(", ".seek(", ".currentTime", "playbackRate"];
const noForbidden = (s: string) => FORBIDDEN.every((f) => !s.includes(f));

// ---------- (a) snapshot per-motion (opts tetap -> fragmen tetap) ----------
assert.deepStrictEqual(
  punchIn({ target: "#bg0", at: 0, duration: 3, intensity: 0.5, zoomIn: true, dir: 1 }),
  [`tl.fromTo("#bg0",{scale:1.120,xPercent:2.000,yPercent:1.200},{scale:1.370,xPercent:-2.000,yPercent:-1.200,duration:3.000,ease:"power1.out"},0.000);`],
);
assert.deepStrictEqual(
  whipPan({ target: "#cw1", at: 5, intensity: 0.5, dir: 1 }),
  [`tl.fromTo("#cw1",{xPercent:65,scale:1.12,opacity:.3},{xPercent:0,scale:1,opacity:1,duration:0.280,ease:"power4.out"},5.000);`],
);
assert.deepStrictEqual(
  flash({ at: 10, intensity: 0.6 }),
  [
    `tl.fromTo("#flash",{opacity:0},{opacity:0.62,duration:0.050,ease:"power1.out"},10.000);`,
    `tl.to("#flash",{opacity:0,duration:0.160,ease:"power2.in"},10.050);`,
  ],
);
assert.deepStrictEqual(
  textReveal({ target: "#g0w0", at: 1, intensity: 0.6 }),
  [`tl.fromTo("#g0w0",{opacity:0,scale:0.54,y:21},{opacity:1,scale:1,y:0,duration:0.176,ease:"back.out(2)"},1.000);`],
);
assert.deepStrictEqual(
  countUp({ varName: "o0", numId: "num0", num: 350000, grouped: true, at: 4, intensity: 0.6 }),
  [`var o0={v:0};tl.to(o0,{v:350000,duration:0.940,ease:"power2.out",onUpdate:function(){document.getElementById("num0").textContent=fmtNum(o0.v,true);}},4.000);`],
);
assert.deepStrictEqual(
  lowerThirdInOut({ target: "#lt", inAt: 2, outAt: 6, intensity: 0.6 }),
  [
    `tl.fromTo("#lt",{opacity:0,y:33},{opacity:1,y:0,duration:0.440,ease:"power3.out"},2.000);`,
    `tl.to("#lt",{opacity:0,duration:0.350,ease:"power2.in"},6.000);`,
  ],
);
// determinisme: opts sama -> output sama persis (dua panggilan terpisah).
for (const f of [
  () => punchIn({ target: "#bg0", at: 0, duration: 3, intensity: 0.4 }),
  () => whipPan({ target: "#cw1", at: 5, intensity: 0.4 }),
  () => flash({ at: 2, intensity: 0.4 }),
  () => textReveal({ target: "#g0w0", at: 1, intensity: 0.4 }),
  () => countUp({ varName: "o0", numId: "num0", num: 8, grouped: false, at: 4, intensity: 0.4 }),
  () => lowerThirdInOut({ target: "#lt", inAt: 2, outAt: 6, intensity: 0.4 }),
]) assert.deepStrictEqual(f(), f());
ok("6 motion: snapshot fragmen GSAP stabil & deterministik utk opts tetap");

// semua fragmen patuh kontrak (tak ada kontrol media)
const allFrag = [
  ...punchIn({ target: "#bg0", at: 0, duration: 3, intensity: 1 }),
  ...whipPan({ target: "#cw1", at: 5, intensity: 1 }),
  ...flash({ at: 2, intensity: 1 }),
  ...textReveal({ target: "#g0w0", at: 1, intensity: 1 }),
  ...countUp({ varName: "o0", numId: "num0", num: 9, grouped: true, at: 4, intensity: 1 }),
  ...lowerThirdInOut({ target: "#lt", inAt: 2, outAt: 6, intensity: 1 }),
].join("\n");
assert.ok(noForbidden(allFrag), "fragmen motion tak boleh panggil .play/.pause/.seek/.currentTime/playbackRate");
assert.ok(MOTION_IDS.every((id) => MOTION_COST[id] === "cheap"), "6 motion harus cost 'cheap' (BeginFrame)");
ok("kontrak fragmen: tanpa kontrol media; 6 motion cost 'cheap' (BeginFrame, bukan screenshot)");

// ---------- (b) intensitas punya efek nyata (low != high) ----------
assert.notDeepStrictEqual(punchIn({ target: "#b", at: 0, duration: 1, intensity: 0.1 }), punchIn({ target: "#b", at: 0, duration: 1, intensity: 0.9 }));
assert.notDeepStrictEqual(whipPan({ target: "#c", at: 0, intensity: 0.1 }), whipPan({ target: "#c", at: 0, intensity: 0.9 }));
assert.notDeepStrictEqual(flash({ at: 0, intensity: 0.1 }), flash({ at: 0, intensity: 0.9 }));
assert.notDeepStrictEqual(textReveal({ target: "#g", at: 0, intensity: 0.1 }), textReveal({ target: "#g", at: 0, intensity: 0.9 }));
assert.notDeepStrictEqual(countUp({ varName: "o", numId: "n", num: 5, grouped: false, at: 0, intensity: 0.1 }), countUp({ varName: "o", numId: "n", num: 5, grouped: false, at: 0, intensity: 0.9 }));
assert.notDeepStrictEqual(lowerThirdInOut({ target: "#l", inAt: 0, outAt: 2, intensity: 0.1 }), lowerThirdInOut({ target: "#l", inAt: 0, outAt: 2, intensity: 0.9 }));
ok("6 motion: intensitas low != high (parameter berefek nyata, bukan label)");

// ---------- (c) pack DISABLED -> buildComposition identik baseline ----------
const golden = JSON.parse(readFileSync(join(__dirname, "fixtures/hf-golden/buildComposition.json"), "utf8"));
for (const [k, v] of Object.entries(GOLDEN_INPUTS)) assert.strictEqual(sha(buildComposition(v)), golden[k], `golden ${k}`);
for (const [k, v] of Object.entries(GOLDEN_INPUTS)) assert.strictEqual(buildComposition({ ...v, motionPack: undefined }), buildComposition(v), `omit==undefined ${k}`);
// brandKit tanpa motionPack / enabled:false -> resolve null -> jalur lama.
assert.strictEqual(resolveMotionPackConfig(undefined), null);
assert.strictEqual(resolveMotionPackConfig({ tone: "playful" }), null, "tanpa enabled:true -> null");
assert.strictEqual(resolveMotionPackConfig({ enabled: false, tone: "playful" }), null);
assert.strictEqual(resolveBrandKit(JSON.stringify({ subtitleFont: "anton" }))?.motionPackEnabled, false);
assert.strictEqual(resolveBrandKit(JSON.stringify({ motionPack: { enabled: false } }))?.motionPackConfig, null);
ok("disabled: 4 golden snapshot identik + motionPack:undefined == baseline + resolve null (back-compat)");

// ---------- (d) premium vs friendly vs playful -> output beda ----------
const pre = resolveMotionPackConfig({ enabled: true, tone: "premium" })!;
const fri = resolveMotionPackConfig({ enabled: true, tone: "friendly" })!;
const pla = resolveMotionPackConfig({ enabled: true, tone: "playful" })!;
assert.ok(pre.eases.pop !== pla.eases.pop && pre.intensity !== pla.intensity);
assert.ok(pre.enabled.flash === false && pla.enabled.flash === true && pre.enabled.whipPan === false && fri.enabled.whipPan === true);
// fragmen motion yang sama beda antar tone (ease + intensitas)
assert.notDeepStrictEqual(
  textReveal({ target: "#g", at: 1, intensity: pre.intensity, ease: pre.eases.pop }),
  textReveal({ target: "#g", at: 1, intensity: pla.intensity, ease: pla.eases.pop }),
);
assert.notDeepStrictEqual(
  punchIn({ target: "#b", at: 0, duration: 3, intensity: pre.intensity, ease: pre.eases.cam }),
  punchIn({ target: "#b", at: 0, duration: 3, intensity: pla.intensity, ease: pla.eases.cam }),
);
// buildComposition penuh beda antar tone, dan dua-duanya beda dari baseline.
const base = buildComposition(GOLDEN_INPUTS.full);
const hPre = buildComposition({ ...GOLDEN_INPUTS.full, motionPack: pre });
const hPla = buildComposition({ ...GOLDEN_INPUTS.full, motionPack: pla });
assert.ok(hPre !== hPla && hPre !== base && hPla !== base, "premium/playful/baseline tiga-tiganya beda");
assert.ok(hPla.includes('id="flash"') && !hPre.includes('id="flash"'), "flash hanya pada playful (tone-aware)");
ok("tone: premium/friendly/playful beda (ease/intensitas/flash) + buildComposition beda per tone");

// ---------- (e) KONTRAK pada HTML ter-generate (playful = paling agresif) ----------
for (const [k, v] of Object.entries(GOLDEN_INPUTS)) {
  const html = buildComposition({ ...v, motionPack: pla });
  assert.ok(noForbidden(html), `${k}: HTML tak boleh ada kontrol media (.play/.pause/.seek/.currentTime/playbackRate)`);
  assert.ok(html.includes('data-motion-blur="off"') && !html.includes('data-motion-blur="on"'), `${k}: motion-blur tetap off (no screenshot)`);
}
ok("kontrak HTML (4 input, playful): tanpa kontrol media; data-motion-blur tetap 'off' (BeginFrame)");

// ---------- enum/validator/resolver ----------
assert.ok(isMotionTone("premium") && !isMotionTone("fancy") && DEFAULT_MOTION_TONE === "friendly");
assert.ok(resolveMotionTone("ngawur").tone === "friendly" && resolveMotionTone("ngawur").usedFallback === true && resolveMotionTone("playful").usedFallback === false);
assert.ok(isMotionId("punchIn") && !isMotionId("explode") && MOTION_IDS.length === 6);
assert.ok(validateBrandKit({ motionPack: { enabled: true, tone: "playful", intensity: 80, motions: { flash: false } } }).ok === true);
assert.ok(validateBrandKit({ motionPack: { tone: "boom" } }).ok === false);
assert.ok(validateBrandKit({ motionPack: { intensity: 999 } }).ok === false);
assert.ok(validateBrandKit({ motionPack: { enabled: "ya" } }).ok === false);
assert.ok(validateBrandKit({ motionPack: { motions: { punchIn: "x" } } }).ok === false);
assert.ok(validateBrandKit({ motionPack: { motions: { explode: true } } }).ok === true); // key tak dikenal diabaikan (tak disimpan)
// intensity override (0-100 -> 0..1) & toggle per-motion override tone.
const cfgOv = resolveMotionPackConfig({ enabled: true, tone: "premium", intensity: 100, motions: { whipPan: true } })!;
assert.ok(Math.abs(cfgOv.intensity - 1) < 1e-9 && cfgOv.enabled.whipPan === true && cfgOv.tone === "premium");
const cfgDef = resolveMotionPackConfig({ enabled: true })!; // tanpa tone -> default friendly
assert.ok(cfgDef.tone === "friendly" && Math.abs(cfgDef.intensity - TONE_CONFIGS.friendly.intensity) < 1e-9);
assert.ok(resolveBrandKit(JSON.stringify({ motionPack: { enabled: true, tone: "playful" } }))?.motionPackEnabled === true);
ok("enum/validator/resolver: tone fallback, intensity 0-100->0..1, toggle override, brandKit default-off");

console.log(`ALL_MOTION_PACK_1_TESTS_PASS (${n} grup tes)`);
