// Batas waktu generate (2026-11-06) - loop /api/cron/auto-generate dulu bisa jalan 6-9 jam
// & MENAHAN server: long-form (Animal Story) ~1,5-2 jam/video x banyak ide, berurutan,
// tanpa batas apa pun. curl cron disconnect di timeout-nya TAPI kerja di next-server lanjut
// terus (akar runaway). Dua batas di sini:
//  - PER-PUTARAN (round): total loop berhenti saat budget habis; ide sisa dibiarkan
//    used=false -> diambil cron berikutnya. Ini guard UTAMA thd runaway.
//  - PER-VIDEO: 1 render macet tak menahan server tanpa batas. Longgar (long-form memang
//    butuh jam-jaman) - cuma menangkap render yg benar2 nyangkut, bukan long-form normal.
// Keduanya env-default + bisa dioverride per-panggilan (query), supaya timer bisa kirim
// deadline = timeout curl-nya sendiri ("loop berhenti saat cron timeout").

const MIN = 60_000;

// Menit -> ms, ambil dari query lalu env lalu default. Hanya nilai > 0 yg valid.
export function budgetMs(queryMinutes: string | null, envName: string, defaultMin: number): number {
  const q = Number(queryMinutes);
  if (Number.isFinite(q) && q > 0) return q * MIN;
  const e = Number(process.env[envName]);
  if (Number.isFinite(e) && e > 0) return e * MIN;
  return defaultMin * MIN;
}

// Deadline per-putaran. `now` diinjeksi utk test (clock palsu).
export function makeDeadline(ms: number, now: () => number = Date.now): () => boolean {
  const start = now();
  return () => now() - start >= ms;
}

export class StageTimeoutError extends Error {
  constructor(public label: string, public ms: number) {
    super(`timeout ${label} > ${Math.round(ms / 1000)}s`);
    this.name = "StageTimeoutError";
  }
}

// Batasi 1 kerja (render 1 video) agar 1 render macet tak menahan loop tanpa batas.
// CATATAN (ponytail): race ini melepas LOOP saat timeout, TAPI tidak mematikan proses
// ffmpeg anak - itu sudah dibatasi timeout+cgroup di ffmpegExec. Hard-kill butuh
// AbortSignal diteruskan ke runAutoContent (belum ada); batas cgroup menjaga CPU sementara
// itu, dan round-budget memastikan loop tetap berhenti.
export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StageTimeoutError(label, ms)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

if (process.argv[1] && process.argv[1].endsWith("renderBudget.ts")) {
  // Self-check (fase5 item c): deadline berhenti pada batas waktu + per-video timeout lempar.
  (async () => {
    const assert = (c: boolean, m: string) => { if (!c) { console.error("FAIL:", m); process.exit(1); } };
    let t = 1000;
    const clock = () => t;
    const deadline = makeDeadline(5000, clock);
    assert(deadline() === false, "deadline belum lewat saat elapsed 0");
    t = 5000; assert(deadline() === false, "deadline belum lewat tepat di bawah batas (4000<5000)");
    t = 6001; assert(deadline() === true, "deadline HARUS lewat saat elapsed 5001>=5000");

    // loop berhenti pada batas: 10 ide, budget cukup utk ~3 saja (tiap ide +2000ms)
    t = 0;
    const d2 = makeDeadline(5000, () => t);
    let done = 0;
    for (let i = 0; i < 10; i++) { if (d2()) break; t += 2000; done++; }
    assert(done === 3, `loop harus berhenti ~3 ide, dapat ${done}`);

    await withTimeout(Promise.resolve("ok"), 1000, "cepat").then((v) => assert(v === "ok", "promise cepat lolos"));
    let threw = false;
    await withTimeout(new Promise((r) => setTimeout(r, 200)), 20, "lambat").catch((e) => { threw = e instanceof StageTimeoutError; });
    assert(threw, "render lambat HARUS lempar StageTimeoutError");
    console.log("renderBudget self-check OK");
  })();
}
