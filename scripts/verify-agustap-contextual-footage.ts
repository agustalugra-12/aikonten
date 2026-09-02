import { isFootageUrlBlocked, deriveAgustapBrollQuery, AGUSTAP_FINANCIAL_BLOCKLIST } from "../src/lib/agustap/contextualFootage";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  console.log("Running Agustap Contextual Footage verification gate\n");

  // isFootageUrlBlocked - deterministik, tanpa API call.
  check(
    "Negative test PRD §28 - URL trading candlestick -> BLOCKED",
    isFootageUrlBlocked("https://www.pexels.com/video/stock-market-candlestick-chart-1234567/", AGUSTAP_FINANCIAL_BLOCKLIST) === true
  );
  check(
    "URL crypto trading dashboard -> BLOCKED",
    isFootageUrlBlocked("https://www.pexels.com/video/crypto-trading-dashboard-7654321/", AGUSTAP_FINANCIAL_BLOCKLIST) === true
  );
  check(
    "URL cafe owner smartphone (relevan) -> TIDAK blocked",
    isFootageUrlBlocked("https://www.pexels.com/video/small-cafe-owner-using-smartphone-9999999/", AGUSTAP_FINANCIAL_BLOCKLIST) === false
  );
  check(
    "Blocklist kosong (brand lain) -> tidak pernah blokir apa pun",
    isFootageUrlBlocked("https://www.pexels.com/video/stock-market-chart-111/", []) === false
  );

  // deriveAgustapBrollQuery - live LLM call kecil, real cost.
  const test1 = await deriveAgustapBrollQuery("UMKM perlu memperbaiki strategi media sosial.");
  check(
    "TEST 1 PRD §27 - UMKM strategi medsos -> blocklist AKTIF (bukan konteks finansial)",
    test1.blockTitleKeywords.length > 0,
    JSON.stringify(test1)
  );
  check(
    "TEST 1 - query TIDAK cuma 'business'/'growth' polos",
    !/^business$|^growth$/i.test(test1.query.trim()),
    test1.query
  );

  const test3 = await deriveAgustapBrollQuery("Analisis performa konten Instagram.");
  check(
    "TEST 3 PRD §27 - analisis performa Instagram -> blocklist AKTIF (analytics != trading)",
    test3.blockTitleKeywords.length > 0,
    JSON.stringify(test3)
  );

  const test4 = await deriveAgustapBrollQuery("Bisnis trading saham perlu memahami risiko pasar.");
  check(
    "TEST 4 PRD §27 - topik MEMANG trading -> blocklist KOSONG (tidak ada global ban, §11)",
    test4.blockTitleKeywords.length === 0,
    JSON.stringify(test4)
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
