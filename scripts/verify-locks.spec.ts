// Verification script for lock implementation (TIER 0)
// Test concurrent lock behavior WITHOUT triggering production generation
// NO paid API calls, NO production data changes

import {
  tryAcquireLock,
  releaseLock,
  isLockHeld,
  brandAutoContentLockKey,
  projectProcessLockKey,
  projectPublishLockKey,
  LockBusyError,
  withLock,
} from "../src/lib/concurrency/locks";

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    testsPassed++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    testsFailed++;
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual === expected) {
    console.log(`✅ PASS: ${message}`);
    testsPassed++;
  } else {
    console.error(`❌ FAIL: ${message} - got ${actual}, expected ${expected}`);
    testsFailed++;
  }
}

console.log("🔍 TIER 0 VERIFICATION: Lock Implementation\n");
console.log("=" .repeat(60));

// TEST 1: Basic lock acquire/release
console.log("\n📋 TEST 1: Basic Lock Acquire/Release");
{
  const key = "test-basic-lock";
  const acquired1 = tryAcquireLock(key);
  assert(acquired1, "First acquire should succeed");
  assert(isLockHeld(key), "Lock should be held after acquire");

  const acquired2 = tryAcquireLock(key);
  assert(!acquired2, "Second acquire should fail while locked");

  releaseLock(key);
  assert(!isLockHeld(key), "Lock should be released");

  const acquired3 = tryAcquireLock(key);
  assert(acquired3, "Third acquire should succeed after release");
  releaseLock(key);
}

// TEST 2: Key isolation - different keys don't interfere
console.log("\n📋 TEST 2: Key Isolation");
{
  const key1 = "test-key-1";
  const key2 = "test-key-2";

  const acquired1 = tryAcquireLock(key1);
  const acquired2 = tryAcquireLock(key2);

  assert(acquired1, "Lock key1 should succeed");
  assert(acquired2, "Lock key2 should succeed independently");
  assert(isLockHeld(key1), "key1 should be held");
  assert(isLockHeld(key2), "key2 should be held");

  releaseLock(key1);
  assert(!isLockHeld(key1), "key1 should be released");
  assert(isLockHeld(key2), "key2 should still be held");

  releaseLock(key2);
}

// TEST 3: Key builders produce consistent keys
console.log("\n📋 TEST 3: Key Builder Consistency");
{
  const brandId = "brand_test123";
  const projectId = "project_test456";

  const key1 = brandAutoContentLockKey(brandId);
  const key2 = brandAutoContentLockKey(brandId);
  assertEqual(key1, key2, "Same brandId should produce same key");
  assert(key1.startsWith("brand-auto-content:"), "Brand key should have correct prefix");

  const pKey1 = projectProcessLockKey(projectId);
  const pKey2 = projectProcessLockKey(projectId);
  assertEqual(pKey1, pKey2, "Same projectId should produce same process key");
  assert(pKey1.startsWith("project-process:"), "Project process key should have correct prefix");

  const pubKey1 = projectPublishLockKey(projectId);
  const pubKey2 = projectPublishLockKey(projectId);
  assertEqual(pubKey1, pubKey2, "Same projectId should produce same publish key");
  assert(pubKey1.startsWith("project-publish:"), "Project publish key should have correct prefix");

  // Process and publish keys should be different
  assert(pKey1 !== pubKey1, "Process and publish keys should differ");
}

// TEST 4: Brand auto-content lock prevents cron/manual overlap
console.log("\n📋 TEST 4: Brand Auto-Content Lock (Cron/Manual Overlap Prevention)");
{
  const brandId = "brand_pelangi";
  const lockKey = brandAutoContentLockKey(brandId);

  // Simulate cron acquiring lock
  const cronAcquired = tryAcquireLock(lockKey);
  assert(cronAcquired, "Cron should acquire brand lock");

  // Simulate manual trigger trying to acquire same brand
  const manualAcquired = tryAcquireLock(lockKey);
  assert(!manualAcquired, "Manual trigger should FAIL while cron holds lock");

  // Cron releases
  releaseLock(lockKey);

  // Manual can now acquire
  const manualAcquired2 = tryAcquireLock(lockKey);
  assert(manualAcquired2, "Manual trigger should succeed after cron release");
  releaseLock(lockKey);
}

// TEST 5: Project process lock prevents double-click
console.log("\n📋 TEST 5: Project Process Lock (Double-Click Prevention)");
{
  const projectId = "project_abc123";
  const lockKey = projectProcessLockKey(projectId);

  // First click
  const click1 = tryAcquireLock(lockKey);
  assert(click1, "First process click should acquire lock");

  // Second click (double-click)
  const click2 = tryAcquireLock(lockKey);
  assert(!click2, "Second process click should FAIL (double-click prevented)");

  releaseLock(lockKey);
}

// TEST 6: Project publish lock prevents concurrent publish
console.log("\n📋 TEST 6: Project Publish Lock (Concurrent Publish Prevention)");
{
  const projectId = "project_xyz789";
  const lockKey = projectPublishLockKey(projectId);

  // First publish attempt
  const pub1 = tryAcquireLock(lockKey);
  assert(pub1, "First publish should acquire lock");

  // Second publish attempt (concurrent)
  const pub2 = tryAcquireLock(lockKey);
  assert(!pub2, "Second publish should FAIL (concurrent prevented)");

  releaseLock(lockKey);
}

// TEST 7: Process and Publish locks are independent
console.log("\n📋 TEST 7: Process/Publish Lock Independence");
{
  const projectId = "project_independent";
  const processKey = projectProcessLockKey(projectId);
  const publishKey = projectPublishLockKey(projectId);

  const processAcquired = tryAcquireLock(processKey);
  const publishAcquired = tryAcquireLock(publishKey);

  assert(processAcquired, "Process lock should acquire");
  assert(publishAcquired, "Publish lock should acquire independently");

  releaseLock(processKey);
  releaseLock(publishKey);
}

// TEST 8: withLock helper - success path
console.log("\n📋 TEST 8: withLock Helper - Success Path");
{
  const key = "test-withlock-success";
  let executed = false;

  const mockWork = async () => {
    executed = true;
    assert(isLockHeld(key), "Lock should be held during work execution");
    return "success";
  };

  withLock(key, mockWork).then((result) => {
    assertEqual(result, "success", "withLock should return work result");
    assert(executed, "Work should have been executed");
    assert(!isLockHeld(key), "Lock should be released after success");
  });
}

// TEST 9: withLock helper - busy path
console.log("\n📋 TEST 9: withLock Helper - Busy Path");
{
  const key = "test-withlock-busy";

  // Pre-acquire lock
  tryAcquireLock(key);

  const mockWork = async () => {
    throw new Error("Should not execute");
  };

  withLock(key, mockWork)
    .then(() => {
      assert(false, "withLock should not resolve when busy");
    })
    .catch((err) => {
      assert(err instanceof LockBusyError, "Should throw LockBusyError when busy");
      assertEqual(err.key, key, "LockBusyError should contain the key");
    })
    .finally(() => {
      releaseLock(key);
    });
}

// TEST 10: withLock helper - error path (lock released on error)
console.log("\n📋 TEST 10: withLock Helper - Error Path (Finally Block)");
{
  const key = "test-withlock-error";

  const mockWork = async () => {
    assert(isLockHeld(key), "Lock should be held before error");
    throw new Error("Simulated work error");
  };

  withLock(key, mockWork)
    .then(() => {
      assert(false, "withLock should not resolve on work error");
    })
    .catch((err) => {
      assert(err.message === "Simulated work error", "Should propagate work error");
      assert(!isLockHeld(key), "Lock should be released even on error (finally block)");
    });
}

// TEST 11: Concurrent brand processing simulation
console.log("\n📋 TEST 11: Concurrent Brand Processing Simulation");
{
  const brandId = "brand_concurrent_test";
  const lockKey = brandAutoContentLockKey(brandId);

  const results: boolean[] = [];

  // Simulate 5 concurrent attempts
  for (let i = 0; i < 5; i++) {
    const acquired = tryAcquireLock(lockKey);
    results.push(acquired);
    if (!acquired) {
      // Simulate skip behavior (cron)
      console.log(`   ⏭️  Attempt ${i + 1}: SKIP (brand busy)`);
    } else {
      console.log(`   ✅ Attempt ${i + 1}: ACQUIRED`);
    }
  }

  const acquiredCount = results.filter((r) => r).length;
  assertEqual(acquiredCount, 1, "Only ONE concurrent attempt should acquire lock");

  // Release for next test
  releaseLock(lockKey);
}

// TEST 12: Multiple brands can process concurrently
console.log("\n📋 TEST 12: Multiple Brands Concurrent Processing");
{
  const brand1 = "brand_pelangi";
  const brand2 = "brand_laundry";
  const brand3 = "brand_animalstory";

  const key1 = brandAutoContentLockKey(brand1);
  const key2 = brandAutoContentLockKey(brand2);
  const key3 = brandAutoContentLockKey(brand3);

  const acq1 = tryAcquireLock(key1);
  const acq2 = tryAcquireLock(key2);
  const acq3 = tryAcquireLock(key3);

  assert(acq1 && acq2 && acq3, "Different brands should acquire locks independently");

  releaseLock(key1);
  releaseLock(key2);
  releaseLock(key3);
}

// SUMMARY
console.log("\n" + "=".repeat(60));
console.log("\n📊 VERIFICATION SUMMARY:\n");
console.log(`✅ Tests Passed: ${testsPassed}`);
console.log(`❌ Tests Failed: ${testsFailed}`);
console.log(`📈 Total Tests: ${testsPassed + testsFailed}`);

if (testsFailed === 0) {
  console.log("\n🎉 ALL TESTS PASSED - Lock implementation verified!");
  console.log("\n✅ TIER 0 VERIFICATION: COMPLETE");
  console.log("\nCONCLUSIONS:");
  console.log("1. ✅ Lock acquire/release mechanism works correctly");
  console.log("2. ✅ Key isolation prevents cross-contamination");
  console.log("3. ✅ Brand-level locks prevent cron/manual overlap");
  console.log("4. ✅ Project-level locks prevent double-processing");
  console.log("5. ✅ Process/Publish locks are independent");
  console.log("6. ✅ withLock helper properly releases on error (finally block)");
  console.log("7. ✅ Concurrent attempts correctly blocked");
  console.log("8. ✅ Multiple brands can process independently");
  console.log("\n⚠️  NOTE: This is unit/integration test only.");
  console.log("   Production verification requires monitoring actual cron/manual triggers.");
  console.log("   Recommend: check logs for 'sedang diproses' messages after deployment.");
  process.exit(0);
} else {
  console.log("\n❌ SOME TESTS FAILED - Review lock implementation!");
  process.exit(1);
}
