// Tulis golden hash buildComposition (jalankan HANYA dari kode lama yang belum diubah).
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildComposition } from "../src/lib/render/hyperframesComposition";
import { GOLDEN_INPUTS } from "./hf-golden-inputs";
const out: Record<string, string> = {};
for (const [k, v] of Object.entries(GOLDEN_INPUTS)) out[k] = createHash("sha256").update(buildComposition(v)).digest("hex");
writeFileSync(join(__dirname, "fixtures/hf-golden/buildComposition.json"), JSON.stringify(out, null, 1) + "\n");
console.log(out);
