// Verifikasi lib/concurrency/locks.ts (2026-08-14, temuan #1/#2 Lampiran D
// ENGINEERING_SAFETY.md / audit kontenpilot §4/§6) - PURE LOGIC, tanpa panggilan
// API berbayar apa pun (OpenAI/fal.ai/Buffer dst) dan tanpa side effect nyata - hanya
// menguji perilaku acquire/release lock itu sendiri dgn kerja PALSU (delay Promise),
// sama pola dgn scripts/verify-tree-merge-plan.ts. Jalankan: npx tsx scripts/verify-locks.ts

import { tryAcquireLock, releaseLock, isLockHeld, withLock, LockBusyError } from "../src/lib/concurrency/locks";

let failed = false;

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed = true;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

async function assertRejects(promise: Promise<unknown>, msg: string) {
  try {
    await promise;
    console.error(`FAIL: ${msg} - expected reject, got resolve`);
    failed = true;
  } catch (err) {
    if (err instanceof LockBusyError) {
      console.log(`PASS: ${msg}`);
    } else {
      console.error(`FAIL: ${msg} - rejected with unexpected error: ${err}`);
      failed = true;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  // 1) tryAcquireLock/releaseLock primitives - lock dasar
  {
    const key = "test:primitive:1";
    assert(!isLockHeld(key), "key baru belum di-hold");
    assert(tryAcquireLock(key), "acquire pertama berhasil");
    assert(isLockHeld(key), "isLockHeld true setelah acquire");
    assert(!tryAcquireLock(key), "acquire kedua (masih dipegang) gagal - false, bukan throw");
    releaseLock(key);
    assert(!isLockHeld(key), "isLockHeld false setelah release");
    assert(tryAcquireLock(key), "acquire lagi setelah release berhasil (key bebas dipakai ulang)");
    releaseLock(key);
  }

  // 2) release pada key yg TIDAK di-hold - tidak boleh throw (no-op aman)
  {
    releaseLock("test:never-acquired");
    assert(true, "release key yg tidak pernah di-acquire tidak throw");
  }

  // 3) withLock - jalankan fn, lock dilepas otomatis setelah sukses
  {
    const key = "test:withlock:success";
    let ran = false;
    const result = await withLock(key, async () => {
      ran = true;
      assert(isLockHeld(key), "lock dipegang SELAMA fn berjalan");
      return 42;
    });
    assert(ran, "fn benar2 dijalankan");
    assert(result === 42, "withLock mengembalikan hasil fn");
    assert(!isLockHeld(key), "lock dilepas otomatis setelah fn sukses");
  }

  // 4) withLock - fn throw - lock TETAP dilepas (finally), bukan nyangkut selamanya
  {
    const key = "test:withlock:throws";
    await withLock(key, async () => {
      throw new Error("simulated failure di dalam fn");
    }).catch(() => {});
    assert(!isLockHeld(key), "lock dilepas walau fn throw (try/finally) - tidak nyangkut selamanya");
    // Buktikan key benar2 bebas dipakai lagi (bukan cuma isLockHeld yg salah lapor)
    assert(tryAcquireLock(key), "key bisa di-acquire lagi setelah fn sebelumnya throw");
    releaseLock(key);
  }

  // 5) SKENARIO INTI - dua "panggilan bersamaan" utk key yg SAMA: panggilan kedua HARUS
  // ditolak (LockBusyError) SELAMA panggilan pertama masih "in flight" (disimulasikan
  // dgn delay, mewakili pipeline berbayar yg lama - OpenAI+fal.ai+TTS+ffmpeg - TANPA
  // benar2 memanggilnya).
  {
    const key = "test:concurrent:project-X";
    let firstFnStarted = false;
    let firstFnFinished = false;

    const firstCall = withLock(key, async () => {
      firstFnStarted = true;
      await delay(50); // simulasi kerja lama (render/generate), BUKAN API call nyata
      firstFnFinished = true;
      return "hasil-panggilan-pertama";
    });

    // Beri kesempatan event loop utk benar2 masuk ke firstCall (microtask/timer) sebelum
    // menembak panggilan kedua - meniru "hampir bersamaan tapi ada gap kecil", skenario
    // realistis (klik dobel, retry manual vs cron) bukan literally instruksi CPU yg sama.
    await delay(5);
    assert(firstFnStarted, "panggilan pertama sudah mulai jalan (lock sudah dipegang)");
    assert(!firstFnFinished, "panggilan pertama BELUM selesai saat panggilan kedua ditembak");

    // Panggilan KEDUA utk key YANG SAMA, SELAGI yg pertama masih "in flight" - HARUS
    // ditolak segera (LockBusyError), TIDAK ikut menjalankan fn-nya sendiri.
    let secondFnRan = false;
    await assertRejects(
      withLock(key, async () => {
        secondFnRan = true;
        return "TIDAK SEHARUSNYA SAMPAI SINI";
      }),
      "panggilan kedua utk key sama selagi pertama in-flight DITOLAK (LockBusyError)"
    );
    assert(!secondFnRan, "fn panggilan kedua TIDAK PERNAH dijalankan sama sekali (ditolak sebelum eksekusi)");

    const firstResult = await firstCall;
    assert(firstResult === "hasil-panggilan-pertama", "panggilan pertama tetap selesai normal & dpt hasil benar");
    assert(firstFnFinished, "panggilan pertama benar2 selesai (bukan diinterupsi krn panggilan kedua ditolak)");

    // 6) SETELAH lock pertama dilepas (selesai, sukses ATAU gagal) - panggilan BARU utk
    // key yg SAMA harus DIIZINKAN lagi (bukan nyangkut permanen).
    assert(!isLockHeld(key), "lock benar2 bebas setelah panggilan pertama selesai");
    const thirdResult = await withLock(key, async () => "panggilan-ketiga-setelah-lock-bebas");
    assert(thirdResult === "panggilan-ketiga-setelah-lock-bebas", "panggilan baru stlh lock bebas berhasil normal");
  }

  // 7) Key BEDA tidak saling block - brand A memproses tidak boleh menahan brand B
  // (relevan langsung ke cron/auto-generate: lock per-brandId, bukan 1 lock global).
  {
    const keyA = "test:independent:brand-A";
    const keyB = "test:independent:brand-B";
    assert(tryAcquireLock(keyA), "acquire brand A berhasil");
    assert(tryAcquireLock(keyB), "acquire brand B (key beda) berhasil WALAU brand A masih dipegang");
    releaseLock(keyA);
    releaseLock(keyB);
  }

  // 8) Prefix key beda utk domain beda (project-process vs project-publish) - render &
  // publish project YANG SAMA tidak saling block (2 tahap independen, lihat komentar
  // orchestrate.ts/processProject.ts) - disimulasikan langsung dgn 2 key literal beda
  // prefix (bukan import projectProcessLockKey/projectPublishLockKey krn itu cuma
  // string template trivial, sudah cukup diverifikasi via type-check + code review).
  {
    const processKey = "project-process:proj_sama123";
    const publishKey = "project-publish:proj_sama123";
    assert(tryAcquireLock(processKey), "lock project-process utk projectId X berhasil");
    assert(tryAcquireLock(publishKey), "lock project-publish utk projectId X SAMA tetap berhasil (prefix beda, tidak saling block)");
    releaseLock(processKey);
    releaseLock(publishKey);
  }

  // 9) Simulasi persis skenario cron/auto-generate: N "invocation" bersamaan utk brand
  // yg SAMA - HANYA SATU yg boleh benar2 menjalankan kerja beratnya (fn), sisanya
  // ditolak sebelum sempat jalan - meniru "curl timeout, operator re-trigger manual
  // sementara run lama masih jalan" dari call-endpoint.sh.
  {
    const brandKey = "test:cron-scenario:brand-Pelangi";
    let executedCount = 0;
    const attempts = [1, 2, 3, 4, 5].map((n) =>
      withLock(brandKey, async () => {
        executedCount++;
        await delay(20);
        return `run-${n}`;
      }).catch((err) => (err instanceof LockBusyError ? "SKIPPED" : "UNEXPECTED_ERROR"))
    );
    const results = await Promise.all(attempts);
    assert(executedCount === 1, `HANYA 1 dari 5 invocation bersamaan yg benar2 jalan (dpt: ${executedCount})`);
    const skippedCount = results.filter((r) => r === "SKIPPED").length;
    assert(skippedCount === 4, `4 invocation lain di-skip bersih via LockBusyError (dpt: ${skippedCount})`);
    assert(!results.includes("UNEXPECTED_ERROR"), "tidak ada error tak terduga di skenario 5x-bersamaan");
  }

  console.log(failed ? "\n=== ADA YANG FAIL ===" : "\n=== SEMUA PASS ===");
  process.exit(failed ? 1 : 0);
}

main();
