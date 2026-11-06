// Tahap 6: builder VideoPlan + golden jalur lama + flag per brand. Jalankan: npx tsx scripts/verify-videoplan-builder.ts
import assert from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildComposition } from "../src/lib/render/hyperframesComposition";
import { buildCompositionFromPlan, planWindows, type PlanMedia } from "../src/lib/video/planBuilder";
import { validateVideoPlan, type VideoPlan } from "../src/lib/video/videoPlan";
import { validateBrandKit, brandKitVideoPlanMode } from "../src/lib/render/brandKit";
import { GOLDEN_INPUTS } from "./hf-golden-inputs";
import { loadFixture, DOMAINS } from "./verify-videoplan";

let n = 0;
const ok = (m: string) => console.log(`  ok ${++n} - ${m}`);

export function wordsFor(audio: number) {
  const ws = [] as Array<{ word: string; start: number; end: number }>;
  for (let t = 0.1, i = 0; t + 0.3 < audio; t += 0.42, i++) ws.push({ word: i % 9 === 8 ? `kata${i}.` : `kata${i}`, start: t, end: t + 0.3 + (i % 9 === 8 ? 0 : 0) });
  return ws;
}
export function mediaFor(domain: string, f = loadFixture(domain)): PlanMedia {
  return {
    // Metadata subjek (revisi 2026-11-05): footage hook dideskripsikan sesuai isi hook -> boleh jadi hero.
    footage: Object.fromEntries(f.ctx.footageIds.map((id, i) => [id, { videoUrl: `https://r2.example/${id}.mp4`, durationSeconds: 8, mediaStart: i === 1 ? 2 : 0,
      subject: { description: id === (f.valid.scenes as Array<{ footageRef?: string }>)[0].footageRef ? String((f.valid.scenes as Array<{ text?: string }>)[0].text) : id.replace(/-/g, " "), source: "vision" as const } }])),
    audioUrl: "https://r2.example/vo.mp3", audioDurationSeconds: f.ctx.audioDurationSeconds, words: wordsFor(f.ctx.audioDurationSeconds),
    musicUrl: "https://r2.example/m.mp3", brand: { primary: "#1B4332", accent: "#F4A261", cta: "#E63946", name: domain }, seed: `p-${domain}`,
  };
}

if (require.main === module) {
  // 1. Golden: jalur lama byte-identik setelah field opsional ditambahkan.
  const golden = JSON.parse(readFileSync(join(__dirname, "fixtures/hf-golden/buildComposition.json"), "utf8"));
  for (const [k, v] of Object.entries(GOLDEN_INPUTS)) assert.strictEqual(createHash("sha256").update(buildComposition(v)).digest("hex"), golden[k], `golden ${k}`);
  ok(`buildComposition lama identik dgn golden (${Object.keys(golden).length} snapshot: full/faceless/landscape/empty)`);

  for (const d of DOMAINS) {
    const f = loadFixture(d);
    const v = validateVideoPlan(f.valid, f.ctx);
    assert.ok(v.ok);
    const plan = (v as { plan: VideoPlan }).plan;
    const m = mediaFor(d, f);
    const b = buildCompositionFromPlan(plan, m);
    const html = b.html;
    const H = plan.scenes[0].duration, total = H + m.audioDurationSeconds;
    // Durasi & jendela adegan: kontigu, total = hook + VO.
    const last = b.windows[b.windows.length - 1];
    assert.ok(Math.abs(last.start + last.dur - total) < 1e-6);
    b.windows.forEach((w, i) => { if (i) assert.ok(Math.abs(b.windows[i - 1].start + b.windows[i - 1].dur - w.start) < 1e-6); assert.ok(w.dur >= 0.8 - 1e-9); });
    assert.ok(html.includes(`data-duration="${total.toFixed(3)}"`));
    // Hero-first: klip-0 = footage hook.
    const firstSrc = /<video id="bg0"[^>]*src="([^"]+)"/.exec(html)![1];
    assert.strictEqual(firstSrc, m.footage[b.heroRef!].videoUrl);
    assert.strictEqual(b.heroRef, (plan.scenes[0] as { footageRef?: string }).footageRef);
    // VO mulai setelah hook; musik pakai volume plan; caption 1 baris (revisi) tetap ada.
    assert.ok(html.includes(`<audio id="vo" class="clip" data-start="${H.toFixed(3)}"`));
    assert.ok(html.includes(`id="bgm" class="clip" data-start="0" data-volume="${plan.music.volume}"`));
    assert.ok(html.includes('class="vpcl"') && !html.includes('class="capgroup"'));
    // Tak ada aset luar selain URL media yang diberikan (tanpa CDN).
    const srcs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((x) => x[1]);
    const allowed = new Set([...Object.values(m.footage).map((x) => x.videoUrl), m.audioUrl!, m.musicUrl!]);
    for (const s of srcs) assert.ok(allowed.has(s) || s.startsWith("./vendor/") || s.startsWith("./fonts/"), `aset luar: ${s}`);
    assert.ok(!/url\((?!"\.\/fonts)/.test(html), "tak ada url() selain font lokal");
    // Setiap adegan non-hook dgn overlay punya layer; overlay lama (stat/cta otomatis) tak dobel.
    for (const [i, w] of b.windows.entries()) if (!["hook", "footage-caption"].includes(w.scene.type)) assert.ok(html.includes(`id="sc${i}`), `${d}: layer adegan ${w.scene.type}`);
    assert.ok(!html.includes('id="statCard0"') && !html.includes('<div id="cta">'));
    // Deterministik per seed.
    assert.strictEqual(buildCompositionFromPlan(plan, m).html, html);
  }
  ok("4 domain: jendela adegan kontigu (total = hook+VO), hero=klip-0, VO setelah hook, musik vol plan, caption tetap, tanpa aset luar, layer per adegan, deterministik");

  // 2. mediaStart dijaga (segmen sumber + offset plan) & footage dipakai ulang lanjut dari bagian berikutnya.
  {
    const f = loadFixture("hospitality"), m = mediaFor("hospitality", f);
    const plan = structuredClone(f.valid) as unknown as VideoPlan;
    const b = buildCompositionFromPlan(plan, m);
    // scene room: footage hosp-room (index 1 -> segmen mulai 2s) + mediaStart plan 1.5 => 3.5
    const roomIdx = b.clipScenes.indexOf("room");
    assert.ok(b.input.clips![roomIdx].mediaStart === 3.5);
    const reuse = structuredClone(plan); (reuse.scenes[2] as { footageRef?: string }).footageRef = "hosp-pool";
    const b2 = buildCompositionFromPlan(reuse, m);
    assert.ok(b2.input.clips![b2.clipScenes.indexOf("price")].mediaStart! >= plan.scenes[0].duration - 1e-9, "pakai ulang pool -> lanjut setelah bagian hook");
  }
  ok("mediaStart = awal segmen + offset plan; footage dipakai ulang melanjutkan, tak mengulang frame sama");

  // 3. Transisi: cut tanpa overlap/animasi; flash -> overlay putih; before-after = 2 klip + wipe.
  {
    const f = loadFixture("laundry"), m = mediaFor("laundry", f);
    const b = buildCompositionFromPlan(f.valid as unknown as VideoPlan, m);
    assert.deepStrictEqual(b.input.transitions!.slice(0, 3), ["cut", "whip", "slide"]);
    assert.ok(b.html.includes('id="vpFlash"') && /tl\.fromTo\("#vpFlash"/.test(b.html));
    assert.ok(b.clipScenes.filter((x) => x === "ba").length === 2 && b.html.includes('class="vp-wipe"'));
    const cutIdx = b.input.transitions!.indexOf("cut", 1);
    assert.ok(cutIdx > 0 && !b.html.includes(`tl.fromTo("#cw${cutIdx}"`), "cut: tanpa animasi wrapper");
  }
  ok("transisi per adegan diterapkan (cut tanpa overlap, flash overlay, before-after 2 klip + wipe)");

  // 4. Sinkron cut ke VO (jeda kata) & beat.
  {
    const plan = loadFixture("animal").valid as unknown as VideoPlan;
    const words = wordsFor(16);
    const win = planWindows(plan, 16, words, null);
    const gaps = words.slice(0, -1).map((w, i) => plan.scenes[0].duration + (w.end + words[i + 1].start) / 2);
    for (const w of win.slice(2)) assert.ok(gaps.some((g) => Math.abs(g - w.start) < 1e-9), `cut ${w.start.toFixed(2)} di jeda kata`);
    const raw = planWindows(plan, 16, [], null), winB = planWindows(plan, 16, [], 0.5);
    let snapped = 0;
    winB.slice(2).forEach((w, i) => {
      const o = raw[i + 2].start, q = Math.round(o / 0.5) * 0.5;
      if (Math.abs(q - o) <= 0.15) { assert.ok(Math.abs(w.start - q) < 1e-9, "cut dekat beat -> di beat"); snapped++; } else assert.ok(Math.abs(w.start - o) < 1e-9);
    });
    assert.ok(snapped >= 1, "minimal 1 cut ter-snap ke beat");
  }
  ok("batas adegan di-snap ke jeda kata VO (±0.35s) dan ke beat musik (±0.15s)");

  // 5. Faceless bila tak ada footage dikenal; mood none -> tanpa musik.
  {
    const f = loadFixture("business"), m = { ...mediaFor("business", f), footage: {} };
    const plan = structuredClone(f.valid) as unknown as VideoPlan; plan.music.mood = "none";
    const b = buildCompositionFromPlan(plan, m);
    assert.ok(b.html.includes('id="facelessBg"') && !b.html.includes("<video") && !b.html.includes('id="bgm"'));
  }
  ok("tanpa footage -> faceless (background brand); mood none -> tanpa musik");

  // 6. Flag per brand: default OFF, validator menolak aktivasi, pembaca selalu off.
  assert.ok(validateBrandKit({ videoPlanMode: "off" }).ok);
  const on = validateBrandKit({ videoPlanMode: "on" });
  assert.ok(!on.ok && /approval/.test((on as { error: string }).error));
  assert.strictEqual(brandKitVideoPlanMode('{"videoPlanMode":"on"}'), "off");
  assert.strictEqual(brandKitVideoPlanMode(null), "off");
  ok("flag brandKit.videoPlanMode: default off, 'on' ditolak validator (butuh approval), pembaca selalu off");

  // 7. Pipeline produksi belum memanggil builder baru (jalur lama tetap satu-satunya).
  const pp = readFileSync(join(__dirname, "../src/lib/pipeline/processProject.ts"), "utf8") + readFileSync(join(__dirname, "../src/lib/render/hyperframesRender.ts"), "utf8");
  assert.ok(!pp.includes("buildCompositionFromPlan"));
  ok("processProject/hyperframesRender tak memanggil builder VideoPlan (aktivasi menunggu approval)");
  console.log(`ALL_VIDEOPLAN_BUILDER_TESTS_PASS (${n} tes)`);
}
