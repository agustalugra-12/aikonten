#!/bin/bash
# Efek suara VideoPlan (whoosh transisi, hit stat/CTA) DISINTESIS dari generator ffmpeg (noise/sine) ->
# karya sendiri, tanpa sampel pihak ketiga, bebas lisensi (setara CC0). Pakai: scripts/gen-sfx.sh <dir-keluaran>
set -euo pipefail
out="${1:?dir keluaran}"; mkdir -p "$out"
ffmpeg -v error -y -f lavfi -i "anoisesrc=d=0.45:c=pink:a=0.7:seed=7" -af "highpass=f=350,lowpass=f=5000,afade=t=in:d=0.22,afade=t=out:st=0.22:d=0.23,volume=0.8" -ar 44100 -ac 1 "$out/whoosh.wav"
ffmpeg -v error -y -f lavfi -i "sine=f=95:d=0.32" -f lavfi -i "anoisesrc=d=0.04:c=white:a=0.5:seed=3" -filter_complex "[0]afade=t=out:st=0.04:d=0.28[a];[1]highpass=f=1500[b];[a][b]amix=inputs=2:duration=longest,volume=1.6" -ar 44100 -ac 1 "$out/hit.wav"
echo "SFX: $(ls "$out")"
