#!/usr/bin/env python3
# Render a Lottie JSON animation to a transparent PNG frame sequence for ffmpeg overlay
# compositing (2026-08-11, permintaan Agus - "kerjakan semua" utk 9 file Lottie yg
# dikirim via Drive). General-purpose tool, dipakai ulang tiap kali ada JSON baru
# (bukan skrip sekali-pakai) - lihat lottieOverlay.ts di sisi TypeScript utk
# konsumsinya di render pipeline.
#
# Kenapa 2 tahap (SVG dulu, baru rasterize) - lottie package Python HANYA py exporter
# PNG lewat cairosvg atau glaxnimate (dicek langsung dari source module, bukan tebak),
# keduanya TIDAK terinstall. export_svg (exporter dasar, SUDAH terbukti jalan) + sharp
# Node (SUDAH terbukti dipakai berkali2 di project ini utk SVG->PNG, mis. ikon Lucide)
# menghindari nambah dependency baru (cairosvg) drpd install lagi yg tidak perlu.
#
# Usage: .venv-lottie/bin/python3 render_lottie.py <json_path> <out_dir> \
#          [--fps 15] [--max-seconds N] [--width 600]
import argparse
import json
import os
import shutil
import subprocess

from lottie.objects import Animation
from lottie.exporters.svg import export_svg

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = "/root/kontenpilot-ai"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("json_path")
    ap.add_argument("out_dir")
    ap.add_argument("--fps", type=float, default=15.0, help="output sample fps (subsampled from native fr)")
    ap.add_argument("--max-seconds", type=float, default=None, help="cap exported duration (default: full native length)")
    ap.add_argument("--start-seconds", type=float, default=0.0, help="skip this many seconds from the start (mis. lewati bagian intro yg tidak dipakai)")
    ap.add_argument("--width", type=int, default=600, help="rasterized PNG width in px (height auto, aspect preserved)")
    args = ap.parse_args()

    with open(args.json_path) as f:
        anim = Animation.load(json.load(f))

    native_fr = anim.frame_rate
    ip = anim.in_point + args.start_seconds * native_fr
    op = anim.out_point
    native_seconds = max(0.0, (op - ip) / native_fr)

    export_seconds = min(native_seconds, args.max_seconds) if args.max_seconds else native_seconds
    frame_count = max(1, round(export_seconds * args.fps))

    os.makedirs(args.out_dir, exist_ok=True)
    # Bersihkan frame PNG lama (kalau di-render ulang dgn param beda, jangan sampai
    # frame sisa dari run sebelumnya - mis. frame_count lebih besar - ikut kepakai).
    for fn in os.listdir(args.out_dir):
        if fn.startswith("f") and fn.endswith(".png"):
            os.remove(os.path.join(args.out_dir, fn))

    svg_dir = os.path.join(args.out_dir, "_svg_tmp")
    if os.path.exists(svg_dir):
        shutil.rmtree(svg_dir)
    os.makedirs(svg_dir)

    for i in range(frame_count):
        t = ip + (i / args.fps) * native_fr
        t = min(t, op - 0.001)  # jangan sampai lewat frame terakhir animasi
        svg_path = os.path.join(svg_dir, f"f{i:04d}.svg")
        # pretty=True WAJIB (bug nyata ditemukan sebelumnya - pretty=False keluarkan
        # bytes bukan str, gagal ditulis mode "w" di 8/9 file tes awal).
        with open(svg_path, "w") as f:
            export_svg(anim, f, frame=t, pretty=True)

    subprocess.run(
        ["node", os.path.join(SCRIPT_DIR, "rasterize.mjs"), svg_dir, args.out_dir, str(args.width)],
        check=True,
        cwd=PROJECT_DIR,
    )
    shutil.rmtree(svg_dir)

    meta = {
        "frameCount": frame_count,
        "fps": args.fps,
        "nativeWidth": anim.width,
        "nativeHeight": anim.height,
    }
    with open(os.path.join(args.out_dir, "meta.json"), "w") as f:
        json.dump(meta, f)

    print(f"OK: {frame_count} frames @ {args.fps}fps ({export_seconds:.2f}s) -> {args.out_dir}")


if __name__ == "__main__":
    main()
