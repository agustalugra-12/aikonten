import { isIdeSpesifikProperti } from "../src/lib/ai/classifyIdea";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean) {
  if (condition) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.error(`✗ ${name}`);
  }
}

check(
  "Pelangi + sebut harga kamar -> spesifik properti (true)",
  isIdeSpesifikProperti("Promo harga kamar bulan ini", "pelangi") === true
);
check(
  "Harmoni + sebut fasilitas -> spesifik properti (true)",
  isIdeSpesifikProperti("Fasilitas kolam renang villa", "harmoni") === true
);
check(
  "Agustap Studio (bukan properti, tapi knowledgeSite non-null) + sebut 'harga' konteks UMKM -> BUKAN spesifik properti (false) - bug nyata 2026-09-02",
  isIdeSpesifikProperti("3 kesalahan harga yang bikin UMKM rugi", "agustap_studio") === false
);
check(
  "Brand tanpa knowledgeSite (laundry/animal story) + sebut 'harga' -> false (regresi lama tetap fixed)",
  isIdeSpesifikProperti("Harga cuci sepatu murah", null) === false
);
check(
  "Pelangi + topik umum tanpa keyword properti -> false",
  isIdeSpesifikProperti("Tips liburan santai di sekitar homestay pas weekend", "pelangi") === false
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
