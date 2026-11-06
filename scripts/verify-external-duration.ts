// Aturan durasi video tenant EKSTERNAL 30-60 dtk (2026-11-05). Tes murni/mock: tanpa DB, jaringan, OpenAI, ffmpeg.
//   npx tsx scripts/verify-external-duration.ts
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { pastikanFormatDiizinkan, VideoPanjangTidakTersediaError, DurasiVideoTidakValidError } from "../src/lib/billing/aturanProduk";
import { batasRenderDetik, cekDurasiHasil, durasiTargetDiizinkan, pilihanDurasiVideo, rencanaDurasiVoiceover, targetNaskahDetik, TEMPO_MAKS, VO_MAKS_EKSTERNAL } from "../src/lib/billing/durasiVideo";
import { sesuaikanDurasiVoiceover } from "../src/lib/ai/dubbing";

let n = 0;
const ok = (m: string) => console.log(`  ok ${++n} - ${m}`);
const src = (p: string) => readFileSync(p, "utf8");
const throwsOf = (f: () => void) => { try { f(); return null; } catch (e) { return e as Error; } };

(async () => {
  // 1. UI: pilihan durasi
  assert.deepStrictEqual(pilihanDurasiVideo("landscape", false), [30, 60]);
  assert.deepStrictEqual(pilihanDurasiVideo("portrait", false), [30, 60]);
  assert.deepStrictEqual(pilihanDurasiVideo("landscape", true), [30, 60, 90, 180, 300, 480]);
  assert.deepStrictEqual(pilihanDurasiVideo("portrait", true), [30, 60]);
  assert.ok(durasiTargetDiizinkan(30, false) && durasiTargetDiizinkan(60, false) && !durasiTargetDiizinkan(90, false) && !durasiTargetDiizinkan(20, false) && durasiTargetDiizinkan(480, true));
  for (const f of ["src/components/dashboard/BuatKonten.tsx", "src/components/dashboard/BrandSettingsSidebar.tsx"]) assert.ok(src(f).includes("pilihanDurasiVideo(") && src(f).includes("ownerUnlimited === true"), f);
  assert.ok(/r\.orientation === "landscape" && unlimited && \(/.test(src("src/components/dashboard/Planner.tsx")) && src("src/app/page.tsx").includes("unlimited={currentBrand?.ownerUnlimited === true}"));
  assert.ok(src("src/app/api/brands/route.ts").includes("ownerUnlimited: !!u?.unlimited"));
  // UI Gaya Visual (VisualStylePanel): opsi mesin render "Desain" (scenes) disembunyikan utk tenant eksternal.
  const vsp = src("src/components/dashboard/VisualStylePanel.tsx");
  assert.ok(/ENGINES\.filter\(\(e\) => e\.value !== "scenes"\)/.test(vsp) && vsp.includes("ownerUnlimited === true") && vsp.includes("engines.map("), "VisualStylePanel sembunyikan scenes utk eksternal");
  ok("UI: eksternal hanya 30/60 dtk (Buat Konten, Pengaturan Brand, Planner) & engine scenes disembunyikan (Gaya Visual); internal tetap semua preset");

  // 2. Validasi target (API/cron/planner) sebelum kredit
  const e90 = throwsOf(() => pastikanFormatDiizinkan({ type: "video", contentFormat: null, videoDurationTarget: 90, unlimited: false }));
  assert.ok(e90 instanceof VideoPanjangTidakTersediaError);
  const e20 = throwsOf(() => pastikanFormatDiizinkan({ type: "video", contentFormat: null, videoDurationTarget: 20, unlimited: false }));
  assert.ok(e20 instanceof DurasiVideoTidakValidError && e20 instanceof VideoPanjangTidakTersediaError && /30-60 detik/.test(e20.message), String(e20));
  const eSc = throwsOf(() => pastikanFormatDiizinkan({ type: "video", contentFormat: null, videoDurationTarget: 60, unlimited: false, renderEngine: "scenes" }));
  assert.ok(eSc instanceof DurasiVideoTidakValidError && /Desain/.test(eSc.message));
  // PATCH /api/brands menolak brandKit.renderEngine "scenes" utk tenant eksternal SAAT DISIMPAN (bukan cuma saat generate).
  const brandRouteSrc = src("src/app/api/brands/[id]/route.ts");
  assert.ok(brandRouteSrc.includes('res.value.renderEngine === "scenes"') && brandRouteSrc.includes("pemilik?.unlimited"), "PATCH brand tolak scenes eksternal");
  for (const a of [
    { type: "video", contentFormat: null, videoDurationTarget: 30, unlimited: false },
    { type: "video", contentFormat: null, videoDurationTarget: null, unlimited: false },
    { type: "video", contentFormat: "youtube_shorts", videoDurationTarget: 300, unlimited: false },
    { type: "video", contentFormat: null, videoDurationTarget: 480, unlimited: true, renderEngine: "scenes" },
    { type: "carousel", contentFormat: "poster_feed", videoDurationTarget: 300, unlimited: false },
  ]) assert.strictEqual(throwsOf(() => pastikanFormatDiizinkan(a)), null, JSON.stringify(a));
  // Brand PATCH & baris Planner menolak durasi di luar 30-60 utk eksternal; planner write-back menyaring.
  for (const f of ["src/app/api/brands/[id]/route.ts", "src/app/api/brands/[id]/content-plan/[rowId]/route.ts", "src/lib/pipeline/generatePlanRow.ts"]) assert.ok(src(f).includes("durasiTargetDiizinkan("), f);
  ok("validasi: eksternal 90/20 dtk & engine scenes ditolak jelas; 30/60/null/Shorts lolos; internal & carousel tak berubah; API brand/planner ikut");

  // 3. Penolakan SEBELUM potong kredit & sebelum proses mahal
  for (const f of ["src/app/api/projects/[id]/process/route.ts", "src/app/api/projects/[id]/retry/route.ts"]) {
    const s = src(f);
    assert.ok(s.indexOf("pastikanFormatDiizinkan(") > 0 && s.indexOf("pastikanFormatDiizinkan(") < s.indexOf("await potongKredit(") && s.includes("renderEngine: brandKitRenderEngine("), f);
  }
  const ac = src("src/lib/pipeline/autoContent.ts");
  const early = ac.indexOf('if (desiredType === "video") {');
  assert.ok(early > 0 && early < ac.indexOf("if (!script) {") && ac.indexOf("cekAturanFormat(type, pfAturan") < ac.indexOf("await potongKredit("), "autoContent: cek awal sebelum ide AI, cek akhir sebelum kredit");
  assert.ok(/kodeAturan = "video_panjang"/.test(ac) && src("src/app/api/cron/auto-generate/route.ts").includes('kodeAturan === "video_panjang"'), "cron melewati ide tanpa retry");
  ok("kredit: aturan dicek sebelum potongKredit (process/retry/autoContent) & di awal autoContent; cron menangani kodeAturan");

  // 4. Naskah: anggaran kata eksternal 32-55 dtk
  assert.strictEqual(targetNaskahDetik(30, false), 32); assert.strictEqual(targetNaskahDetik(60, false), 55); assert.strictEqual(targetNaskahDetik(300, true), 300);
  assert.ok(Math.round(targetNaskahDetik(60, false) * 2.5) <= 140, "<=140 kata utk 60 dtk");
  assert.ok(src("src/lib/pipeline/processProject.ts").includes("targetNaskahDetik(durationConfig.target, pemilikBackstop?.unlimited)"));
  ok("naskah: target kata eksternal dijepit 32-55 dtk (margin dari 30/60), internal apa adanya");

  // 5. TTS: rencana koreksi
  assert.deepStrictEqual(rencanaDurasiVoiceover(45, false), { aksi: "ok" });
  const p62 = rencanaDurasiVoiceover(62, false);
  assert.ok(p62.aksi === "percepat" && p62.tempo <= TEMPO_MAKS && 62 / p62.tempo <= VO_MAKS_EKSTERNAL + 1e-9, JSON.stringify(p62));
  assert.strictEqual(rencanaDurasiVoiceover(70, false).aksi, "gagal");
  assert.deepStrictEqual(rencanaDurasiVoiceover(25, false), { aksi: "tambah_jeda", detik: 5 });
  const g15 = rencanaDurasiVoiceover(15, false);
  assert.ok(g15.aksi === "gagal" && /terlalu pendek/.test(g15.pesan) && /Kredit dikembalikan/.test(g15.pesan));
  assert.deepStrictEqual(rencanaDurasiVoiceover(300, true), { aksi: "ok" });
  ok("TTS: 30-57 dtk ok; >57 percepat <=1.15x; <30 tambah jeda <=8 dtk; di luar itu gagal jelas; internal bebas");

  // 6. TTS: koreksi + ukur ulang (mock ffmpeg/ffprobe)
  const buf = Buffer.from("vo");
  const lens = new Map<Buffer, number>([[buf, 62]]);
  const calls: string[] = [];
  const fake = (after: number) => ({ durasi: async (b: Buffer) => lens.get(b)!, ubah: async (_b: Buffer, f: string) => { calls.push(f); const o = Buffer.from(f); lens.set(o, after); return o; } });
  const r1 = await sesuaikanDurasiVoiceover(buf, false, fake(56.6));
  assert.ok(r1.buffer !== buf && /^atempo=1\.08\d*$/.test(calls[0]) && /percepat 62\.0s -> 56\.6s/.test(r1.catatan!), r1.catatan!);
  lens.set(buf, 26); calls.length = 0;
  const r2 = await sesuaikanDurasiVoiceover(buf, false, fake(30.3));
  assert.ok(calls[0] === "apad=whole_dur=30.3" && /tambah_jeda/.test(r2.catatan!));
  lens.set(buf, 62); calls.length = 0;
  await assert.rejects(sesuaikanDurasiVoiceover(buf, false, fake(59)), /masih di luar batas/);
  lens.set(buf, 80); calls.length = 0;
  await assert.rejects(sesuaikanDurasiVoiceover(buf, false, fake(57)), /terlalu panjang/); assert.strictEqual(calls.length, 0, "gagal sebelum ffmpeg");
  lens.set(buf, 45);
  assert.deepStrictEqual(await sesuaikanDurasiVoiceover(buf, false, fake(0)), { buffer: buf, catatan: null });
  const r3 = await sesuaikanDurasiVoiceover(buf, true, { durasi: async () => { throw new Error("tak boleh diukur"); } });
  assert.strictEqual(r3.buffer, buf);
  const pp = src("src/lib/pipeline/processProject.ts");
  assert.ok(pp.indexOf("sesuaikanDurasiVoiceover(voiceoverBuffer") > pp.indexOf("await generateVoiceover(narrationText") && pp.indexOf("sesuaikanDurasiVoiceover(voiceoverBuffer") < pp.indexOf("await transcribeAudioBuffer(voiceoverBuffer)"), "koreksi sebelum Whisper/render");
  ok("TTS: atempo/jeda lalu ukur ulang; masih di luar batas/terlalu jauh -> error jelas (refund oleh pemanggil); internal tak diukur");

  // 7. Render: batas keras ffmpeg & gerbang pasca-render
  assert.strictEqual(batasRenderDetik(false, undefined), 60); assert.strictEqual(batasRenderDetik(false, 45), 45);
  assert.strictEqual(batasRenderDetik(true, undefined), undefined); assert.strictEqual(batasRenderDetik(true, 60), 60);
  assert.ok(cekDurasiHasil(29, false) && cekDurasiHasil(61, false) && !cekDurasiHasil(30.2, false) && !cekDurasiHasil(60.4, false) && cekDurasiHasil(15, true) === null);
  assert.ok(pp.includes("maxDurationSeconds: batasRenderDetik(pemilikBackstop?.unlimited") && pp.indexOf("cekDurasiHasil(rendered.durationSeconds") < pp.indexOf("runVideoQualityChecks(rendered.videoUrl"));
  ok("render: fallback ffmpeg dijepit -t 60 utk eksternal; hasil di luar 30-60 dtk ditolak sebelum QC/publish");

  console.log(`ALL_EXTERNAL_DURATION_TESTS_PASS (${n} tes)`);
})().catch((e) => { console.error(e); process.exit(1); });
