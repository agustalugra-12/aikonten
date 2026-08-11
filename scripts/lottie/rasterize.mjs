// Helper util for render_lottie.py - rasterizes a directory of per-frame SVGs (exported
// by the Python `lottie` package, which can only export SVG - PNG export needs
// cairosvg/glaxnimate, neither installed) into transparent PNGs, using `sharp` (already
// proven in this repo for SVG->PNG, e.g. Lucide icon downloads - no new dependency).
import sharp from "sharp";
import { readdir, readFile } from "fs/promises";
import path from "path";

const [, , svgDir, outDir, widthArg] = process.argv;
const width = parseInt(widthArg, 10);

const files = (await readdir(svgDir)).filter((f) => f.endsWith(".svg")).sort();
if (files.length === 0) throw new Error(`no SVG frames found in ${svgDir}`);

for (const file of files) {
  const svg = await readFile(path.join(svgDir, file));
  const outName = file.replace(/\.svg$/, ".png");
  await sharp(svg, { density: 300 })
    .resize({ width, height: null })
    .png()
    .toFile(path.join(outDir, outName));
}

console.log(`rasterized ${files.length} frames -> ${outDir}`);
