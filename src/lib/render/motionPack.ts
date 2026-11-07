// Motion Pack 1 (2026-11-06) - registry motion kohesif & tone-aware untuk jalur render
// HyperFrames (GSAP). Pola SAMA dgn motionPresets.ts / subtitleDesign.ts: enum ID + isX
// type-guard + resolveX fallback-aman + fungsi MURNI (tak ada string mentah dari user;
// brandKit cuma simpan enum/boolean/angka, di-resolve di sini). Tiap fungsi mengembalikan
// fragmen tl-line GSAP (string[]) utk DIDORONG ke master timeline paused di buildComposition.
//
// KONTRAK (hyperframesClient.ts / composition): motion HANYA tween GSAP di master timeline.
// DILARANG emit .play()/.pause()/.seek()/.currentTime/playbackRate pada elemen media (worker
// yg pegang pemutaran via data-start/data-duration/data-media-start). CSS filter:blur() di
// dalam tween BOLEH (tetap di jalur cepat BeginFrame) - TAPI JANGAN set data-motion-blur="on"
// (memaksa screenshot html-in-canvas, ~+14-41% biaya render, dilarang Agus). 6 motion di sini
// semua "cheap" (BeginFrame): transform/opacity/warna numerik + 1 overlay putih flash.
//
// speed-ramp SENGAJA TIDAK ada: butuh playbackRate di elemen media -> melanggar kontrak.

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const r3 = (x: number) => x.toFixed(3);

// ---------- Tone ----------
export const MOTION_TONE_IDS = ["premium", "friendly", "playful"] as const;
export type MotionTone = (typeof MOTION_TONE_IDS)[number];
export const DEFAULT_MOTION_TONE: MotionTone = "friendly";

export function isMotionTone(v: unknown): v is MotionTone {
  return typeof v === "string" && (MOTION_TONE_IDS as readonly string[]).includes(v);
}
export function resolveMotionTone(id: unknown): { tone: MotionTone; usedFallback: boolean } {
  if (isMotionTone(id)) return { tone: id, usedFallback: false };
  return { tone: DEFAULT_MOTION_TONE, usedFallback: id !== undefined && id !== null };
}

// ---------- Motion IDs + cost tier ----------
export const MOTION_IDS = ["punchIn", "whipPan", "flash", "textReveal", "countUp", "lowerThird"] as const;
export type MotionId = (typeof MOTION_IDS)[number];

export function isMotionId(v: unknown): v is MotionId {
  return typeof v === "string" && (MOTION_IDS as readonly string[]).includes(v);
}

// Semua 6 motion = "cheap" (jalur cepat BeginFrame worker, bukan screenshot). Kalau suatu
// hari ada motion yg memaksa data-motion-blur="on" / html2canvas -> tandai "expensive" + default-OFF.
export const MOTION_COST: Record<MotionId, "cheap" | "expensive"> = {
  punchIn: "cheap", whipPan: "cheap", flash: "cheap", textReveal: "cheap", countUp: "cheap", lowerThird: "cheap",
};

// ---------- Tone -> konfigurasi ----------
// premium = tertahan (ease power2/power3 tanpa overshoot, intensitas rendah, flash OFF).
// friendly = sedang (back.out lembut, intensitas menengah, flash OFF).
// playful = berenergi (back.out(2+), intensitas tinggi, flash ON, stagger lebih "snappy").
type ToneConfig = {
  intensity: number; // 0..1 default (dipakai kalau brand tak override intensity)
  motions: Record<MotionId, boolean>;
  eases: { pop: string; cam: string; whip: string };
};
export const TONE_CONFIGS: Record<MotionTone, ToneConfig> = {
  premium: {
    intensity: 0.3,
    motions: { punchIn: true, whipPan: false, flash: false, textReveal: true, countUp: true, lowerThird: true },
    eases: { pop: "power3.out", cam: "power2.out", whip: "power3.out" },
  },
  friendly: {
    intensity: 0.55,
    motions: { punchIn: true, whipPan: true, flash: false, textReveal: true, countUp: true, lowerThird: true },
    eases: { pop: "back.out(1.4)", cam: "power1.out", whip: "power4.out" },
  },
  playful: {
    intensity: 0.85,
    motions: { punchIn: true, whipPan: true, flash: true, textReveal: true, countUp: true, lowerThird: true },
    eases: { pop: "back.out(2.2)", cam: "power1.out", whip: "power4.out" },
  },
};

// Konfigurasi motion pack ter-resolve yg di-plumb ke HfCompositionInput.motionPack.
export type MotionPackConfig = {
  tone: MotionTone;
  intensity: number; // 0..1 efektif
  enabled: Record<MotionId, boolean>;
  eases: { pop: string; cam: string; whip: string };
};

// Resolve dari field brandKit.motionPack mentah (sudah di-JSON.parse). DEFAULT-OFF:
// enabled !== true -> null (buildComposition pakai jalur lama, output byte-identik).
export function resolveMotionPackConfig(raw: unknown): MotionPackConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const m = raw as { enabled?: unknown; tone?: unknown; intensity?: unknown; motions?: unknown };
  if (m.enabled !== true) return null;
  const tone = resolveMotionTone(m.tone).tone;
  const tc = TONE_CONFIGS[tone];
  // brand bisa override intensity global (0-100 di brandKit -> 0..1); tak diisi = default tone.
  const intensity = typeof m.intensity === "number" && Number.isFinite(m.intensity)
    ? clamp(m.intensity / 100, 0, 1)
    : tc.intensity;
  const mo = (m.motions && typeof m.motions === "object" && !Array.isArray(m.motions)) ? (m.motions as Record<string, unknown>) : {};
  const enabled = {} as Record<MotionId, boolean>;
  for (const id of MOTION_IDS) enabled[id] = typeof mo[id] === "boolean" ? (mo[id] as boolean) : tc.motions[id];
  return { tone, intensity, enabled, eases: tc.eases };
}

// ---------- Fungsi motion MURNI (satu per motion) ----------
// Tiap fungsi: opts bertipe, mengembalikan string[] fragmen tl-line. `intensity` 0..1 punya
// EFEK NYATA (skala/jarak/durasi), bukan label. Posisi timeline (`at`) & target diisi pemanggil.

// 1. punch-in (reuse Ken Burns #bg<i>). intensity -> delta zoom 0.10..0.40 + jarak pan.
//    Scale dasar 1.12 + delta jaga frame tetap menutup (tak ada tepi hitam); pan dibatasi.
export type PunchInOpts = { target: string; at: number; duration: number; intensity: number; zoomIn?: boolean; dir?: number; ease?: string };
export function punchIn(o: PunchInOpts): string[] {
  const i = clamp(o.intensity, 0, 1);
  const base = 1.12;
  const kb = 0.1 + i * 0.3; // delta zoom (intensity): 0.10 (halus) .. 0.40 (dramatis)
  const pan = (2 + i * 4) * 0.5; // % pan konservatif (maks ~3%) biar frame tetap menutup
  const d = o.dir ?? 1;
  const s0 = o.zoomIn ? base : base + kb, s1 = o.zoomIn ? base + kb : base;
  const ease = o.ease ?? "power1.out";
  return [`tl.fromTo("${o.target}",{scale:${r3(s0)},xPercent:${r3(d * pan)},yPercent:${r3(d * pan * 0.6)}},{scale:${r3(s1)},xPercent:${r3(-d * pan)},yPercent:${r3(-d * pan * 0.6)},duration:${r3(o.duration)},ease:"${ease}"},${r3(o.at)});`];
}

// 2. whip-pan (reuse transisi whip di wrapper #cw<i>). intensity -> jarak lempar 35%..95%.
export type WhipPanOpts = { target: string; at: number; intensity: number; dir?: number; duration?: number; ease?: string };
export function whipPan(o: WhipPanOpts): string[] {
  const i = clamp(o.intensity, 0, 1);
  const dist = Math.round(35 + i * 60); // jarak lempar horizontal (intensity): 35%..95%
  const dur = o.duration ?? 0.34 - i * 0.12; // makin energik makin snappy (0.34..0.24)
  const d = o.dir ?? 1;
  const ease = o.ease ?? "power4.out";
  return [`tl.fromTo("${o.target}",{xPercent:${d * dist},scale:1.12,opacity:.3},{xPercent:0,scale:1,opacity:1,duration:${r3(dur)},ease:"${ease}"},${r3(o.at)});`];
}

// 3. flash (BARU). Overlay putih #flash kedip cepat di titik cut. intensity -> opasitas
//    puncak 0.35..0.80. Murni opacity tween di 1 div -> jalur cepat BeginFrame (TANPA blur/
//    screenshot). opt-in via tone (playful) / toggle.
export type FlashOpts = { at: number; intensity: number; target?: string };
export function flash(o: FlashOpts): string[] {
  const i = clamp(o.intensity, 0, 1);
  const t = o.target ?? "#flash";
  const peak = (0.35 + i * 0.45).toFixed(2); // opasitas puncak (intensity)
  const up = 0.05, down = 0.12 + (1 - i) * 0.1; // naik instan, turun makin lambat utk intensity rendah
  return [
    `tl.fromTo("${t}",{opacity:0},{opacity:${peak},duration:${r3(up)},ease:"power1.out"},${r3(o.at)});`,
    `tl.to("${t}",{opacity:0,duration:${r3(down)},ease:"power2.in"},${r3(o.at + up)});`,
  ];
}

// 4. tiered text-reveal (reuse caption word pop-in #g<gi>w<wi>). intensity -> kedalaman pop
//    (scaleFrom 0.75..0.40) + jarak naik (10..28px) + durasi. Stagger "tier" datang dari
//    timing kata (pemanggil atur `at` per kata) - di sini 1 kata = 1 fragmen pop.
export type TextRevealOpts = { target: string; at: number; intensity: number; duration?: number; ease?: string };
export function textReveal(o: TextRevealOpts): string[] {
  const i = clamp(o.intensity, 0, 1);
  const scaleFrom = (0.75 - i * 0.35).toFixed(2); // makin tinggi intensity makin "pop" (mulai lebih kecil)
  const yFrom = Math.round(10 + i * 18);
  const dur = o.duration ?? 0.14 + i * 0.06;
  const ease = o.ease ?? "back.out(2)";
  return [`tl.fromTo("${o.target}",{opacity:0,scale:${scaleFrom},y:${yFrom}},{opacity:1,scale:1,y:0,duration:${r3(dur)},ease:"${ease}"},${r3(o.at)});`];
}

// 5. counting-numbers (reuse stat count-up o{v:0} -> fmtNum). intensity -> durasi hitung
//    (inverse: makin energik makin cepat, 1.3s..0.7s). grouped = pemisah ribuan.
export type CountUpOpts = { varName: string; numId: string; num: number; grouped: boolean; at: number; intensity: number; duration?: number; ease?: string };
export function countUp(o: CountUpOpts): string[] {
  const i = clamp(o.intensity, 0, 1);
  const dur = o.duration ?? 0.7 + (1 - i) * 0.6; // 1.3s (premium, elegan) .. 0.7s (playful, snappy)
  const ease = o.ease ?? "power2.out";
  return [`var ${o.varName}={v:0};tl.to(${o.varName},{v:${o.num},duration:${r3(dur)},ease:"${ease}",onUpdate:function(){document.getElementById("${o.numId}").textContent=fmtNum(${o.varName}.v,${o.grouped});}},${r3(o.at)});`];
}

// 6. lower-third in/out (reuse #lt). intensity -> jarak naik masuk (16..44px) + durasi masuk.
export type LowerThirdOpts = { target: string; inAt: number; outAt: number; intensity: number; easeIn?: string; easeOut?: string; durIn?: number; durOut?: number };
export function lowerThirdInOut(o: LowerThirdOpts): string[] {
  const i = clamp(o.intensity, 0, 1);
  const y = Math.round(16 + i * 28);
  const dIn = o.durIn ?? 0.35 + i * 0.15;
  const dOut = o.durOut ?? 0.35;
  const easeIn = o.easeIn ?? "power3.out";
  const easeOut = o.easeOut ?? "power2.in";
  return [
    `tl.fromTo("${o.target}",{opacity:0,y:${y}},{opacity:1,y:0,duration:${r3(dIn)},ease:"${easeIn}"},${r3(o.inAt)});`,
    `tl.to("${o.target}",{opacity:0,duration:${r3(dOut)},ease:"${easeOut}"},${r3(o.outAt)});`,
  ];
}
