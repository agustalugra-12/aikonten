# Render Tree-Merge: Percepat Long-Form Render Tanpa Timeout

## Latar Belakang

Migrasi Animal Story & Co ke VPS baru (2026-08-13/14) menemukan bug OOM nyata: satu
panggilan ffmpeg dengan N input sekaligus dalam 1 filter_complex xfade chain butuh RAM
sebanding N (46-47 klip = >2.8GB anon-rss, OOM bahkan di VPS dedikasi 3.8GB). Diperbaiki
sementara dengan `mergeClipsIncrementally` (`src/lib/render/ffmpeg.ts`) - gabung klip 2
per panggilan ffmpeg secara BERURUTAN (akumulator + klip berikutnya, akumulator makin
besar tiap langkah).

Fix itu terbukti aman dari OOM (memori konstan ~590MB, tervalidasi 2x render 40+ klip),
tapi punya trade-off: N-1 kali proses ffmpeg dengan biaya re-encode **O(N²)** (tiap
langkah me-re-encode akumulator yang makin panjang) - satu video long-form (44 klip, 222
detik) makan **>2 jam** untuk fase merge+overlay. Target Agus: 3 video long-form/hari,
2 jam/video tidak sustainable untuk batch semalam.

## Tujuan

Percepat render long-form ke **di bawah 1 jam** per video, **tanpa** menambah risiko OOM
(harus tetap cuma 2 input per panggilan ffmpeg) dan **tanpa** mengubah hasil visual
sama sekali (transisi/tipe/timing harus identik dengan skema lama).

## Desain: Tree Merge (Divide & Conquer)

### Prinsip inti - pisahkan KEPUTUSAN dari EKSEKUSI

`buildXfadeFilterComplex` (`src/lib/render/transitions.ts`) sudah menghitung, SEKALI,
keputusan per-boundary (antara klip original k dan k+1): apakah pakai transisi
crossfade atau potong-langsung, dan tipe transisi apa - pakai formula `canUseTransition`/
`getTransitionForStep` yang SUDAH ada (diekstrak 2026-08-14 pas fix OOM). Keputusan ini
murni fungsi dari durasi klip asli, TIDAK bergantung sama sekali pada BAGAIMANA
penggabungan fisik dieksekusi.

Desain baru memisahkan ini jadi 2 tahap:
1. **Planning** (sudah ada, cuma diekspos): hitung `boundaryPlans[k]` untuk k=0..N-2,
   berisi `{ isTransition, transitionType }` - persis logika `buildXfadeFilterComplex`
   yang sudah ada, cuma sekarang hasil per-langkahnya di-return, bukan cuma di-gabung
   jadi 1 string filter.
2. **Execution** (BARU): `mergeClipsTree` - rekursi divide & conquer:
   ```
   mergeRange(lo, hi):
     kalau lo == hi: return klip lo apa adanya (leaf)
     mid = tengah(lo, hi)
     left = mergeRange(lo, mid)      // rekursif
     right = mergeRange(mid+1, hi)   // rekursif
     boundary = boundaryPlans[mid]   // SELALU benar by construction - lihat di bawah
     return mergeDua(left, right, boundary)
   ```

**Kenapa `boundaryPlans[mid]` selalu benar** - `left` mencakup klip asli [lo..mid],
`right` mencakup [mid+1..hi], apapun struktur rekursi di dalamnya. Titik sambung antara
`left` dan `right` SELALU persis boundary original antara klip `mid` dan `mid+1` -
tidak ada ambiguitas, tidak peduli sedalam apa rekursinya. Ini yang membuat skema pohon
AMAN dipakai tanpa mengubah keputusan transisi sama sekali - beda dari kalau eligibility
("boleh transisi atau tidak") dihitung ULANG di tiap node pohon pakai durasi segmen
gabungan (itu BISA menyimpang dari keputusan original, makanya sengaja DIHINDARI -
keputusan diambil SEKALI di awal, tree cuma mengeksekusi).

**Offset xfade per panggilan** tetap dihitung LOKAL (durasi `left` - 0.5), dilacak
bottom-up persis formula lama (`newDuration = leftDur + rightDur - 0.5` kalau transisi,//
`leftDur + rightDur` kalau potong-langsung) - xfade filter ffmpeg selalu menganggap
offset relatif ke input pertamanya sendiri, jadi ini benar di level rekursi manapun.

### Kompleksitas & keamanan memori

- Tiap panggilan ffmpeg TETAP cuma 2 input (`-i left -i right`) - properti OOM-safety
  dari fix sebelumnya TIDAK berubah sama sekali.
- Total panggilan ffmpeg tetap N-1 (sama seperti sequential) - tapi total detik yg
  di-re-encode berkurang dari O(N x durasi_final) jadi O(log N x durasi_final) - untuk
  44 klip, kira-kira 44 "lapis kerja besar" jadi ~6 lapis.
- Preset `ultrafast` tetap dipakai utk semua merge KECUALI merge terakhir (root,
  `lo==0 && hi==N-1`) - sama optimisasi yg sudah ada di versi sequential.

### Perubahan file

- `src/lib/render/transitions.ts`: `buildXfadeFilterComplex` diperluas return-nya
  dengan `boundaryPlans` (array keputusan per-boundary). `filterComplex`/`outputLabel`
  (string filter gabungan) DIHAPUS dari return - sudah tidak dipakai di mana pun sejak
  fix sequential (diverifikasi via grep), dead code.
- `src/lib/render/ffmpeg.ts`: `mergeClipsIncrementally` (sequential) DIGANTI
  `mergeClipsTree` (rekursif). Titik pemanggilan di `renderFinalVideo` disesuaikan.

## Error Handling

Sama seperti sekarang - tiap panggilan `run("ffmpeg", ...)` sudah dibungkus
`FFMPEG_TIMEOUT_MS`/cgroup MemoryMax (tidak berubah). Kalau satu merge gagal, error
langsung dilempar ke atas (tidak ada retry parsial per-node) - konsisten dgn perilaku
sequential sebelumnya, tidak menambah kompleksitas baru.

## Testing

1. **Unit murni (tanpa ffmpeg sungguhan)** - script Node berdiri sendiri yang
   membandingkan `boundaryPlans`/urutan operasi hasil skema tree vs hasil simulasi
   skema sequential lama, untuk beberapa skenario acak (jumlah klip genap/ganjil,
   variasi durasi termasuk klip pendek <1.5dtk yg memicu jalur "tidak bisa transisi") -
   pastikan SETIAP boundary menghasilkan keputusan (transisi/tidak, tipe, offset lokal)
   yg konsisten dgn definisi lama. Murah, bisa diulang berkali-kali.
2. **1x render sungguhan** - baru setelah (1) lolos, jalankan 1x test render long-form
   nyata (biaya API real, dikonfirmasi dulu ke Agus sebelum trigger) - ukur waktu
   total & pastikan hasil video valid (ffprobe) + durasi tetap lolos gerbang minimum.
3. Deploy ke KEDUA server (lama & baru) - kode sama, sudah pola yg dipakai sepanjang
   sesi migrasi ini.

## Di luar scope

- Tidak mengubah kualitas encode (CRF tetap 23), tidak mengubah preset final (tetap
  `veryfast`), tidak mengubah gaya transisi/durasi transisi (`TRANSITION_DURATION_SECONDS`
  tetap 0.5dtk) - murni percepatan eksekusi, nol perubahan visual.
- Tidak menyentuh tahap overlay final (logo/subtitle/musik) - itu proses ffmpeg
  terpisah, sudah diperbaiki soal timeout (40 menit) di pass sebelumnya, di luar scope
  tree-merge ini.
