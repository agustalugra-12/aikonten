# Motion Pack 1 (HyperFrames / GSAP)

2026-11-06 — `feat/motion-pack-1`. Tujuan: video terasa **diedit & bervariasi** (bukan satu
template) lewat motion kohesif & _tone-aware_ di jalur render HyperFrames (GSAP). Jalur FFmpeg
lama TIDAK disentuh (tetap fallback).

- Modul: `src/lib/render/motionPack.ts` (registry fungsi murni).
- Field brand: `brandKit.motionPack` (default-OFF, divalidasi).
- Wiring: `src/lib/render/hyperframesComposition.ts` (opt-in; OFF = output byte-identik),
  di-plumb dari `src/lib/render/hyperframesRender.ts`.
- Tes: `scripts/verify-motion-pack-1.ts` + blok di `tests/critical.ts`.

## 6 motion

| Motion | ID | Asal | Reuse / baru | Intensitas (efek NYATA) | Cost |
|---|---|---|---|---|---|
| Punch-in (Ken Burns) | `punchIn` | `#bg<i>` per klip | reuse (comp. ~L271) | delta zoom **0.10→0.40** + jarak pan (konservatif, frame tetap menutup) | cheap |
| Whip-pan | `whipPan` | wrapper `#cw<i>` transisi | reuse (whip, ~L268) | jarak lempar horizontal **35%→95%** (+ durasi snappy) | cheap |
| Flash | `flash` | overlay `#flash` (BARU) | **baru** | opasitas puncak putih **0.35→0.80** | cheap |
| Tiered text-reveal | `textReveal` | caption `#g<gi>w<wi>` | reuse (pop-in, ~L204) | scale-from **0.75→0.40** + rise **10→28px** + durasi | cheap |
| Counting-numbers | `countUp` | stat `o{v:0}`→`fmtNum` | reuse (~L225) | durasi hitung **1.3s→0.7s** (inverse: energik = cepat) | cheap |
| Lower-third in/out | `lowerThirdInOut` | `#lt` | reuse (~L213-214) | rise masuk **16→44px** + durasi masuk | cheap |

`intensity` global 0..1 (brand override 0-100 → dinormalisasi). Tiap fungsi murni menghitung
magnitudo dari intensity (bukan sekadar label). Posisi timeline (`at`) & selektor diisi pemanggil.

## Cost tier — semua `cheap` (BeginFrame)

Semua motion = transform/opacity/warna numerik GSAP + satu overlay putih (`#flash`, opacity
tween). Tetap di jalur cepat **BeginFrame** worker. `#root` mempertahankan
`data-motion-blur="off"`; nilai `"on"` memaksa capture html-in-canvas (screenshot, ~+14–41%
biaya render) yang DILARANG untuk motion baru. CSS `filter:blur()` di dalam tween boleh (tetap
BeginFrame) — tapi tak dipakai di sini. Kalau suatu saat ada motion yang memaksa screenshot:
tandai `MOTION_COST` = `"expensive"` + default-OFF.

## Tone mapping

`premium | friendly | playful` (default `friendly`). Tone menentukan motion aktif + intensitas
default + ease + flash on/off:

| | intensitas | punchIn | whipPan | flash | textReveal/countUp/lowerThird | ease pop | ease cam | ease whip |
|---|---|---|---|---|---|---|---|---|
| **premium** (tertahan) | 0.30 | ✓ | — | — | ✓ | `power3.out` | `power2.out` | `power3.out` |
| **friendly** (sedang) | 0.55 | ✓ | ✓ | — | ✓ | `back.out(1.4)` | `power1.out` | `power4.out` |
| **playful** (energik) | 0.85 | ✓ | ✓ | ✓ | ✓ | `back.out(2.2)` | `power1.out` | `power4.out` |

premium = ease halus tanpa overshoot, intensitas rendah, flash OFF. playful = `back.out(2+)`,
intensitas tinggi, flash ON, stagger lebih snappy. Dua tone berbeda DIJAMIN menghasilkan output
GSAP berbeda (diuji). `motions.*` boleh override per-motion; `intensity` boleh override global.

Flash dipicu di titik cut: transisi `whip` (rotasi default tiap klip ke-4) atau `cut` eksplisit.

## Kontrak (diverifikasi di tes)

- Motion = HANYA tween GSAP di master timeline paused. TIDAK pernah emit `.play()` / `.pause()`
  / `.seek()` / `.currentTime` / `playbackRate` pada elemen media — worker yang pegang pemutaran
  via `data-start` / `data-duration` / `data-media-start`.
- **speed-ramp SENGAJA DILEWATI**: butuh `playbackRate` pada media → melanggar kontrak. Tidak
  dibangun sama sekali (6 motion polished, bukan 7 setengah jadi).
- `data-motion-blur` tetap `"off"`; tak ada html2canvas / screenshot.
- `brandKit.motionPack` default-OFF; `enabled !== true` → `resolveMotionPackConfig` = `null` →
  buildComposition pakai jalur lama, output **byte-identik** (dijaga golden test:
  `scripts/fixtures/hf-golden/buildComposition.json`).
- Aturan komposisi existing dihormati: hero = klip pertama (klip tak di-reorder), caption/title
  safe-zone & posisi stat/lower-third tak berubah (motion hanya ganti tween masuk/keluar).
