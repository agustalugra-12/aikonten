// Render uji lokal (verifikasi akhir): {plan, media} JSON -> validasi -> builder -> pre-check -> <dir>/index.html.
// Media memakai path RELATIF (./media/...) di direktori proyek; tak ada unggah. Pakai:
//   npx tsx scripts/hf-render-fixture.ts <input.json> <dir-proyek>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateVideoPlan } from "../src/lib/video/videoPlan";
import { buildCompositionFromPlan, type PlanMedia } from "../src/lib/video/planBuilder";
import { staticPreCheck } from "../src/lib/video/renderQc";
const [inp, dir] = process.argv.slice(2);
const { plan, media } = JSON.parse(readFileSync(inp, "utf8")) as { plan: unknown; media: PlanMedia };
const v = validateVideoPlan(plan, { footageIds: Object.keys(media.footage), audioDurationSeconds: media.audioDurationSeconds });
if (!v.ok) { console.error("PLAN_INVALID", v.errors); process.exit(3); }
const b = buildCompositionFromPlan(v.plan, media);
const pre = staticPreCheck(b.html, { allowedMediaHosts: [] });
writeFileSync(join(dir, "index.html"), b.html);
console.log(JSON.stringify({ hero: b.heroRef, total: b.windows.at(-1)!.start + b.windows.at(-1)!.dur, windows: b.windows.map((w) => `${w.scene.type}@${w.start.toFixed(2)}+${w.dur.toFixed(2)}`), clips: b.clipScenes, pre }));
if (pre.some((x) => x.level === "error")) process.exit(4);
