# Rencana Lengkap Adopsi HyperFrames — AI Content Pilot

Nov 3, 2026 · @agust

## Ringkasan

Pekerjaan tersisa dibagi menjadi 8 tahap, dan terminal hanya berhenti di 4 gerbang persetujuan. Posisi awal rencana ini adalah commit `45fd784`, tepat sebelum Uji Terima.

Target akhirnya: AI membuat rencana video JSON, sistem merakit adegan HyperFrames, QC memeriksa hasil, lalu video masuk draf tanpa kurasi manual. FFmpeg tetap menjadi cadangan.

Proyek selesai bila kriteria ini terpenuhi:

- Minimal 3 tenant lulus Uji Terima dengan video otomatis.
- Hook tidak memakai klip jelek atau tidak relevan.
- Render tidak bisa macet tanpa batas, dan kegagalan jatuh ke fallback.
- Tenant baru bisa memakai HyperFrames sesuai kuota.
- Agus menonton hasilnya dan menyatakan selevel pelangi-pro.

## Aturan kerja mandiri

Terminal boleh mengerjakan tahap yang sudah disetujui tanpa menunggu Agus, selama tetap dalam batas di bawah.

**Boleh tanpa bertanya:**

- Membaca kode, log, dan database secara read-only.
- Mengubah kode di branch kerja, menjalankan `tsc`, tes, dan render lokal.
- Commit serta push ke branch kerja `feat/hf-adoption`.
- Memperbaiki tes yang gagal, maksimal 3 kali.

**Wajib menunggu persetujuan Agus:**

- Deploy production, restart layanan, atau mengubah worker di VPS.
- Merge ke `saas-multitenant`.
- Mengubah skema database, default engine, atau kuota tenant.
- Generate video di luar daftar uji, publish ke media sosial, atau memakai biaya berbayar baru.
- Menghapus data, footage, atau file production.

**Setiap tahap selesai, terminal wajib:**

1. Jalankan `git fetch` dan pastikan bekerja dari commit terbaru.
2. Sertakan bukti: commit, hasil tes, dan link atau frame video bila relevan.
3. Tulis laporan singkat: selesai, gagal, risiko, dan langkah berikutnya.
4. Kirim notifikasi ke HP lewat Remote Control saat sampai di gerbang atau terhenti.
5. Pisahkan fakta, asumsi, dan hal yang belum diverifikasi.

## Tahapan kerja tersisa

Kerjakan berurutan, karena tiap tahap menjadi bukti untuk tahap berikutnya. Centang tugas saat laporan dan buktinya sudah ada.

&#91;embedded content: urutan kerja · 8 tahap, 4 gerbang\]

### Tahap 1: Uji Terima awal

Tujuan: mengetahui kualitas nyata di Pelangi, agustap studio, dan laundry in bali.

- [ ] Generate 1 video vertikal 15–30 detik per tenant, satu per satu.
- [ ] Laporkan engine, fallback, waktu render, frame, dan sumber klip pembuka.
- [ ] Nilai hook, footage, caption, overlay, CTA, audio, dan gaya brand.

Selesai bila: ada daftar cacat per tenant. Lanjut ke **Gerbang 1**.

### Tahap 2: Hero shot dan relevansi footage

Tujuan: pembuka selalu kuat dan footage sesuai topik.

- [ ] Terapkan aturan hero dari semua sumber sesuai keputusan Agus.
- [ ] Kurasi jalur foto top-up yang belum tersentuh.
- [ ] Cegah footage salah topik, termasuk kasus golf dan iguana untuk Ankylosaurus.
- [ ] Tandai brand yang footage-nya kurang, jangan dipaksa.

Selesai bila: tiga video uji ulang tidak punya hook atau footage yang gagal.

### Tahap 3: Worker dan antrean

Tujuan: render stabil, bisa dipulihkan, dan adil antar-tenant.

- [ ] Simpan kode worker dan unit service ke `infra/` tanpa rahasia.
- [ ] Pisahkan waktu antre dari waktu render agar deadline tidak palsu.
- [ ] Tambahkan retry terbatas dan kuota per tenant.
- [ ] Uji worker hang, antrean penuh, dan fallback end-to-end.

Selesai bila: semua skenario gagal berakhir jelas, tanpa job tertahan. Perubahan VPS menunggu **Gerbang 2**.

### Tahap 4: Kontrak VideoPlan

Tujuan: AI hanya bisa memilih struktur yang valid.

- [ ] Buat `videoPlan.ts` dengan tipe dan `validateVideoPlan()`.
- [ ] Validasi orientasi, look, pacing, adegan, durasi, transisi, dan batas teks.
- [ ] Tolak `footageRef` yang tidak ada di footage bank atau segmen.

Selesai bila: tes menolak rencana rusak dan menerima contoh valid.

### Tahap 5: AI Director mode bayangan

Tujuan: AI membuat rencana JSON tanpa mengubah video pelanggan.

- [ ] Tambahkan `videoPlan` ke output AI.
- [ ] Jalankan validator dan fallback ke alur lama bila gagal.
- [ ] Log tingkat lolos, alasan gagal, dan biaya AI.

Selesai bila: minimal 20 rencana diuji dan alasan kegagalannya sudah jelas.

### Tahap 6: Builder memakai VideoPlan

Tujuan: `buildComposition` merakit video dari rencana.

- [ ] Buat adapter dari VideoPlan ke builder.
- [ ] Pertahankan hasil lama lewat snapshot.
- [ ] Sediakan feature flag per brand.

Selesai bila: output lama setara, dan satu brand uji berjalan lewat flag.

### Tahap 7: Perpustakaan adegan dan motion

Tujuan: video terasa diedit, bukan hasil satu templat.

- [ ] Lengkapi adegan hook, footage + caption, stat, testimoni, daftar fitur, before/after, dan CTA.
- [ ] Pakai blok HyperFrames yang lisensi dan biaya rendernya aman.
- [ ] Sambungkan potongan dan momen penting ke beat, serta efek suara.
- [ ] Rapikan font dan gaya per brand, termasuk engine `scenes` bila masih dipakai.

Selesai bila: tiga tenant punya gaya berbeda dan lolos penilaian visual. Lanjut ke **Gerbang 3**.

### Tahap 8: QC penuh dan rollout

Tujuan: HyperFrames menjadi engine utama secara aman.

- [ ] Jalankan `hyperframes check` dan snapshot sebelum render akhir.
- [ ] Tentukan render berjalan otomatis, ulang, fallback, atau ditolak.
- [ ] Pantau tingkat gagal, durasi render, fallback, dan beban worker.
- [ ] Aktifkan bertahap: brand internal, tenant uji, lalu default tenant baru.

Selesai bila: kriteria akhir di Ringkasan terpenuhi. Default engine menunggu **Gerbang 4**.

## Keputusan Agus

Hanya empat titik ini yang perlu kamu cek. Di luar gerbang, terminal tetap bekerja dan melapor saat terhenti.

| Gerbang | Kapan | Yang kamu putuskan | Rekomendasi |
| --- | --- | --- | --- |
| 1 | Setelah Tahap 1 | Aturan hero shot dan lanjut atau tidak ke perbaikan footage | Pilih klip skor tertinggi dari semua sumber |
| 2 | Sebelum worker VPS berubah | Setujui perubahan worker, urutan deploy, dan rollback | Setujui hanya bila rollback sudah diuji |
| 3 | Setelah Tahap 7 | Tonton video tiga tenant, lalu nilai sudah selevel pelangi-pro atau belum | Jangan lanjut bila salah satu gagal |
| 4 | Sebelum default berubah | Jadikan HyperFrames default untuk tenant baru dan tentukan kuota | Aktifkan bertahap, FFmpeg tetap cadangan |

Dua keputusan terbuka:

- [ ] Apakah engine `scenes` tetap dijual ke pelanggan? Kalau tidak, cukup dipertahankan tanpa pengembangan baru.
- [ ] Berapa kuota video HyperFrames per paket? Angkanya harus mengikuti hasil pengukuran render, jadi tentukan sebelum Gerbang 4.

## Risiko dan kondisi berhenti

Risiko terbesar saat ini adalah kapasitas worker dan perubahan server tanpa rollback. Terminal harus berhenti dan memberi notifikasi jika salah satu kondisi di tabel terjadi.

| Risiko | Pencegahan | Berhenti bila |
| --- | --- | --- |
| Antrean membuat deadline palsu | Uji satu per satu, lalu pisahkan waktu antre | Fallback terpicu saat worker sehat |
| Worker hanya ada di VPS | Simpan ke `infra/` dan jaga backup | Kode worker berbeda dari salinan repo |
| Upgrade HyperFrames merusak render | Tetap pin 0.8.230 sampai ada uji khusus | Hasil render berubah setelah upgrade |
| Footage tenant kurang atau salah topik | Tandai kekurangan dan minta footage | Hero tidak bisa dipilih dengan yakin |
| Biaya AI dan server naik | Catat biaya per video, uji dalam batch kecil | Biaya melewati batas yang disetujui Agus |
| Video gagal lolos ke pelanggan | QC sebelum draf dan tanpa publish otomatis saat uji | Video gagal QC tetap masuk draf |
| Production terganggu | Deploy bertahap dan pantau log | Health gagal atau error baru muncul |

Jika tes tetap gagal setelah 3 percobaan, terminal berhenti dan melapor. Terminal tidak boleh melewati gerbang hanya karena kamu belum membalas.

## Perintah untuk terminal

Tempel perintah ini untuk mulai. Setelah Gerbang 1 disetujui, cukup kirim perintah lanjutan di bawahnya.

```text
Kita memakai rencana adopsi HyperFrames berikut. Simpan rencana ini ke
docs/hyperframes-adoption-plan.md, lalu kerjakan hanya Tahap 1.

Urutan tahap:
1. Uji Terima awal
2. Hero shot dan relevansi footage
3. Worker dan antrean
4. Kontrak VideoPlan
5. AI Director mode bayangan
6. Builder memakai VideoPlan
7. Perpustakaan adegan dan motion
8. QC penuh dan rollout

Gerbang persetujuan:
1. Setelah Tahap 1
2. Sebelum worker VPS berubah
3. Setelah Tahap 7
4. Sebelum default engine berubah

Boleh tanpa bertanya: baca read-only, ubah kode di branch feat/hf-adoption,
tsc, tes, render lokal, commit, dan push ke branch itu.
Maksimal 3 percobaan untuk memperbaiki tes yang gagal.

Wajib menunggu aku: deploy, restart, ubah worker VPS, merge ke saas-multitenant,
ubah database, default engine, atau kuota, generate video di luar daftar uji,
publish, biaya berbayar baru, dan penghapusan data production.

Mulai dari git fetch dan pastikan commit terbaru minimal 45fd784.
Tahap 1: generate 1 video untuk Pelangi, agustap studio, dan laundry in bali,
satu per satu, tanpa publish. Laporkan engine, fallback, waktu render, frame,
sumber klip pembuka, nilai tiap kriteria, dan cacat utama.

Saat sampai di gerbang atau terhenti, kirim notifikasi ke HP dan berhenti.
Jangan melewati gerbang karena aku belum membalas.
```

Perintah lanjutan setelah kamu menyetujui gerbang:

```text
Gerbang [nomor] disetujui. Keputusan: [isi keputusan].
Lanjutkan sampai gerbang berikutnya, ikuti docs/hyperframes-adoption-plan.md,
lalu laporkan bukti tiap tahap dan berhenti.
```

---

## STATUS CHECKPOINT — Tahap 2 (2026-11-04)

**Branch kerja:** `feat/hf-adoption` (base prod `45fd784`). BELUM deploy/merge.
**Commits Tahap 2:** `9c9ca8f` (doc) · `9b8446f` · `af3318a` · `505081c` (wiring lama, JANGAN deploy) · `0c358e4` · `ff063ac` (terbaru, planHeroAndClips v2 source-aware).

### Sudah selesai & teruji (ff063ac)
`src/lib/ai/footageDirector.ts` — `planHeroAndClips(cands, hook, script)` SOURCE-AWARE (pure):
- BRAND: drop HANYA `avoid`; relevansi rendah/tag kosong/skor 0 TETAP dipakai (ranking saja); tak ada faceless palsu.
- STOK: wajib lolos guard topik (tags/description/probe); tak jelas = `no_basis`; `off_topic` ditolak.
- Sinonim terbatas `SYN_GROUPS` + `canon()` (bukan vision). Normalisasi skor per token unik.
- Faceless hanya kalau nol klip aman. Plan deterministik (heroTags = render & fallback).
- `scripts/verify-hero-selection.ts` — 9 tes PASS (mixed brand, stok-pertama, skor 0, semua avoid, tag kosong, Ankylosaurus golf/iguana, fallback-determinism, sinonim). tsc rc=0.
- Ukur read-only #8 (klip nyata per-video): Pelangi/agustap/laundry FACELESS 0/6; brand hanya `avoid` dibuang.
- `chooseHeroSource` = SHIM brand sementara (dipakai wiring lama 505081c).

### LANGKAH 1 (berikutnya) — perbaiki guard stok
- `sourceQuery` = niat pencarian, BUKAN bukti isi klip. Gunakan metadata HASIL: slug `sourceUrl`, judul, atau tag sumber bila ada. Tak ada metadata isi → `no_basis`.
- Regresi: project Animal Story yang footage-nya golf/kura-kura/iguana → pakai `source_query` + `source_url` NYATA; golf & iguana harus DITOLAK tanpa menambah kata "golf" manual.
- Ukur ulang read-only: Pelangi, **Animal Story**, laundry, agustap → lapor lolos / no_basis / off_topic per sumber.
- Kalau golf/iguana TAK bisa dibedakan dari metadata yang ada → BERHENTI & lapor (jangan tambah vision/biaya).

### LANGKAH 2 (hanya kalau Langkah 1 berhasil) — wiring penuh
- Thread `source`/`tags`/`probe` ke SETIAP klip saat footage-assembly (`processProject.ts` ~711–943).
- Panggil `planHeroAndClips` SEKALI sebelum `editorialPreflight`.
- QC + render HyperFrames + fallback FFmpeg pakai PLAN yang SAMA (klip pertama = `plan.order[0]`).
- Hapus wiring lama (505081c block) + shim `chooseHeroSource`.
- Tes hasil akhir: klip pertama, QC, faceless, fallback.

### Batasan tetap
Jangan deploy/merge/generate/mulai Tahap 3. Worker tak disentuh. Verifikasi 3-video butuh deploy (approval).

---

## CHECKPOINT — Guard v3 (2026-11-04)

**Commit:** `81ccc67` (feat/hf-adoption). Pure function di `footageDirector.ts` (TANPA processProject/wiring).

### Guard v3 (fungsi murni) — selesai & teruji (17 tes PASS, tsc rc=0)
- **Hero vs Reel** (#1): hero wajib relevan kuat (skor >= HERO_MIN_RELEVANCE 0.5); reel boleh klip SUASANA domain-match walau relevansi rendah. Brand: hanya `avoid` dibuang.
- **Profil domain configurable** (#2): `DOMAIN_PROFILES` animal/hospitality/laundry/business (reelCategories + forbidden). Domain tak dikenal -> `universal` + `domainKnown=false`. Tak hardcode per-brand.
- **Kategori terlarang MENANG atas token** (#3): `CATEGORY_LEXICON` + `categoryOf()`; forbidden (mis sport/human_media utk animal) di-drop walau token cocok (golfer-mountain ditolak).
- **Pixabay** (#4): `slugFromSourceUrl` balik "" kalau tak ada kata >=3 huruf (mis `id-85674`) -> no_basis.
- **planFootageSufficiency** (#5): ok/repeat_ok/need_replacement/insufficient, cap repeat 2x (pure; re-search = pipeline nanti).

### Ukur ulang #8 (v3 domain-aware, klip nyata):
| Brand [domain] | unik detik bef->aft | repeat | faceless | kurang | drop |
|---|---|---|---|---|---|
| Pelangi [hospitality] | 22->9 | 2.4x | 0/6 | 6/6 | avoid 3, no_basis 19* |
| Animal Story [animal] | 120->83 | **1.5x** | 1/10 | 1/10 | off_topic 60, forbidden 15 |
| laundry [laundry] | 26->17 | 1.5x | 0/7 | 4/7 | no_basis 12, off_topic 3, avoid 1 |
| agustap [business] | 24->11 | 2.1x | 0/4 | 3/4 | off_topic 10 |
(*Pelangi no_basis = artefak klip image-derived internal tanpa tag/url, bukan stok Pexels.)

Peningkatan vs v2: Animal Story repeat 3.1x->1.5x (ambient hewan dipertahankan domain match), forbidden tangkap golf/human. Target reel repeat <=2x: Animal Story/laundry OK; agustap 2.1x & Pelangi 2.4x sedikit lewat (footage tipis/internal).

### JUJUR: golden set frame-label BELUM
Golden-set 100 klip dgn LABEL FRAME (visual) TIDAK dibuat: download HD Pexels timeout + label visual 100 klip butuh vision/human-in-loop (tak tersedia). Yang ADA: label-SLUG (kategori) + keputusan guard (measurement di atas). Frame-vs-slug discrepancy (audit sebelumnya) menunjukkan slug kadang salah (slug "video of a jelly fish" vs frame jellyfish benar) -> validasi frame perlu sesi khusus/vision. TIDAK diklaim frame-labeled.

### NEXT (belum, nunggu arahan)
- Golden set frame-labeled (butuh vision/human) utk validasi false-reject/accept sejati.
- Tuning: Pelangi no_basis artefak (image-derived), agustap/Pelangi repeat >2x (footage tipis -> re-search di wiring).
- LANGKAH 2 wiring (processProject): thread domain+slug-probe ke semua klip, planHeroAndClips 1x sblm editorialPreflight, QC+render+fallback plan sama, hapus shim.

---

## CHECKPOINT — BAGIAN 1 selesai, BAGIAN 2 (golden set) + GATE, BAGIAN 3 (wiring) BELUM (2026-11-04)

**Commit:** `fca7258` (BAGIAN 1). Branch feat/hf-adoption.

### BAGIAN 1 (guard v3 fix) — SELESAI (20 tes PASS, tsc rc=0)
- #1 forbidden_category HANYA stok; brand tetap hanya drop avoid.
- #2 `kwHits` token-UTUH/frasa (bukan substring): vacation!=cat, season!=sea, education/location aman.
- #3 `matchedCategories`: forbidden hit APA PUN menang (golf+forest+lake -> ditolak sport).
- #4 (brand foto-hasil source=brand+tag asli) = urusan WIRING BAGIAN 3.

### BAGIAN 2 (mini golden set) — SEBAGIAN + JUJUR
29 klip terpilih (Pelangi=0 stok, internal): 15 DROP + 14 KEEP lintas Animal/agustap/laundry.
Frame ffmpeg (timeout 12s, tanpa HD penuh): **ok=12, GAGAL=17/29** (HD lambat). Montage pecah
(file non-contiguous) -> 1 frame terlihat: #1 water buffalo (slug akurat) -> di-DROP utk animal = FALSE REJECT.
Label-SLUG lengkap; label-FRAME hanya 1 terverifikasi (sisanya butuh sesi vision; TIDAK diklaim).
**TEMUAN: FALSE REJECT masif** (stok). Akar: (a) LEXICON sparse (buffalo/stingray/steamer/shirt/shopping tak ada);
(b) PLURAL/singular ("ants"!="ant", "dolphins"!="dolphin", "towels"!="towel", "cows"!="cow").
Contoh false reject: Animal "water buffalo"/"dolphins swimming"/"ants on leaf" DROP; laundry "steaming shirt"/
"towels in cart" DROP (padahal laundry). False accept: belum ketemu hero salah (forbidden selalu di-drop).

### GATE BAGIAN 3 (wiring) — status
- "tidak ada brand keliru dibuang": OK (brand hanya avoid; golden set semua stok).
- "false accept hero = 0": OK by construction (forbidden selalu di-drop -> hero tak pernah forbidden/jelas-salah).
- TAPI false-REJECT stok tinggi (lexicon/plural). Mitigasi: mode default OBSERVE (hanya catat, tak ubah footage).
=> Wiring BOLEH dilanjut dgn default observe (AMAN), TAPI perbaiki lexicon+stemming sebelum mode "full".

### SARAN sebelum "full": perbaiki matching (BELUM dikerjakan)
- Stemming plural ID/EN ringan (buang akhiran s) ATAU tambah plural ke lexicon.
- Perluas CATEGORY_LEXICON (buffalo/stingray/whale/... animal; shirt/towel/steamer/... laundry; shopping/market/... business).
- Ukur ulang golden set stlh perbaikan; target reject salah-topik >=90% + false-reject rendah.

### BAGIAN 3 (wiring) — RENCANA (BELUM dikerjakan, nunggu sesi)
- Thread domain(brand profile) + source/tags/probe(slug) ke SETIAP klip saat footage-assembly processProject (~711-943).
- Satu `planHeroAndClips` SEBELUM editorialPreflight; QC + render + fallback ffmpeg pakai PLAN sama.
- Mode per-brand: **observe** (default, hanya log keputusan, TAK ubah footage) | **hero-only** (pilih hero, tak buang reel) | **full** (guard + cap repeat 2x + flag footage kurang via planFootageSufficiency).
- Hapus `chooseHeroSource` + wiring 505081c.
- Re-search otomatis BELUM wajib: catat kebutuhan pengganti (planFootageSufficiency status=need_replacement).

### RENCANA DEPLOY (observe) + ROLLBACK (saat wiring selesai & disetujui)
- Deploy: merge feat/hf-adoption -> saas-multitenant -> kontenpilot-saas stop+rm .next+build+restart. Default mode=observe -> NOL perubahan footage, hanya log -> aman diamati di prod.
- Rollback: revert commit wiring atau checkout 45fd784 + rebuild. Mode observe juga bisa dimatikan via config brand tanpa redeploy (kalau diimplementasikan sbg brandKit flag).

---

## CHECKPOINT — plural/unknown-reel selesai; frame-label; wiring BELUM (2026-11-04)

**Commit:** `ccf9ab0` (plural #1 + unknown-reel #2). Branch feat/hf-adoption.

### Part 1-3 SELESAI (22 tes PASS, tsc rc=0)
- #1 `singular()` plural->singular (dolphins=dolphin, towels=towel, ants=ant) di canonTokens + kwHits.
- #2 guard stok: buang HANYA forbidden / kategori-DIKENAL-di-luar-domain; UNKNOWN (water buffalo, steaming shirt) -> REEL (benefit of doubt) TAPI heroOK=false (tak jadi hero).
- #3 tes water buffalo / dolphins / ants / steaming shirt / towels / golf.

### Part 4 FRAME-LABEL (jujur): 6 dari 11/12 berhasil (HD timeout); label-frame vs slug:
1 buffalo [Animal reel] frame=kerbau OK-slug (v3 benar: reel, dulu false-reject)
3 ants [Animal reel] frame=tanah (semut samar) slug longgar; reel OK
5 clothesline [agustap reel] frame=jemuran pedesaan OK-slug; reel ambient
7 choosing-clothes [agustap reel] frame=tangan pilih baju OK-slug; reel
9 laundry-roller [laundry HERO] frame=mesin laundry industrial OK-slug; HERO BENAR
11 hanging-laundry [laundry HERO] frame=cucian digantung OK-slug; HERO BENAR
=> 2 hero terverifikasi frame = BENAR (tak ada false accept di keduanya). TIDAK diklaim false-accept=0 global (cuma 6 frame; sisanya gagal ekstrak). Slug akurat 5/6 (ants longgar).

### Part 5-6 WIRING (BELUM - refactor besar processProject, konteks tipis)
Gate: brand-tak-dibuang OK; false-accept-hero=0 (bukti frame 2 hero BENAR, forbidden selalu drop). Lanjut wiring default OBSERVE (aman).
RENCANA:
- Thread per-brand DOMAIN (map brand->profile: homestay=hospitality, laundry=laundry, animal story=animal, agustap=business; default universal) + source/tags/probe(slugFromSourceUrl utk stok, tags/description utk brand) ke SETIAP klip saat footage-assembly (processProject ~711-943). Brand foto-hasil: source=brand + tag/description ASLI (bukan url mp4 derived).
- Satu `planHeroAndClips(cands, hook, script, {domain})` SEBELUM editorialPreflight -> plan.
- QC (editorialPreflight pakai plan.heroTags), render (reorder clips per plan.order, hero=order[0]), fallback ffmpeg: SEMUA pakai plan SAMA.
- MODE per-brand (brandKit.footageGuardMode): observe(DEFAULT, hanya log plan+dropped, TAK ubah footage) | hero-only(hero dari plan, reel tak dibuang) | full(guard penuh + cap repeat 2x via planFootageSufficiency + flag footage kurang).
- Hapus `chooseHeroSource` + blok wiring 505081c.
- Re-search otomatis BELUM wajib: log status need_replacement.

### DEPLOY (observe) + ROLLBACK
- Deploy: merge feat/hf-adoption -> saas-multitenant -> kontenpilot-saas stop+rm .next+build+restart. Default observe -> NOL ubah footage, hanya log -> aman diamati di prod.
- Rollback: revert commit wiring / checkout 45fd784 + rebuild. Mode = brandKit flag -> bisa dimatikan tanpa redeploy.

### SARAN sebelum mode full
Perbaikan v3 (plural+unknown-reel) sudah kurangi false-reject besar. Masih: perluas lexicon (buffalo/stingray/shirt opsional - unknown sudah ke reel), ukur ulang golden set stlh wiring observe kumpulkan data nyata.

---

## Checkpoint Part 5-6: WIRING guard footage (2026-11-04, commit 4dc326d)

**Status: SELESAI.** Belum deploy/merge (prod tetap 45fd784). tsc rc=0, 25/25 tes PASS.

### Yang dikerjakan (sesuai 7 poin)
1. **Bawa source/tag/description/slug/domain ke setiap klip.** Kandidat dibangun di processProject
   sebelum closure render: broll ber-`sourceUrl` = `stock` (skor via `slugFromSourceUrl` = isi klip);
   broll foto-derive + segment bank = `brand` dgn tag ASLI (map `photoClipTagByUrl` by videoUrl +
   `brandVidTags` by sourceUrl, dihoist ke scope fungsi). Domain dari `brandKit.footageDomain`.
2. **Satu `planHeroAndClips` sebelum `editorialPreflight`.** Dihitung SEKALI sebelum closure
   `renderWithSubtitles` -> dipakai render HyperFrames + fallback ffmpeg + editorialPreflight
   (`heroFootageTags`). Tidak ada perhitungan hero ganda.
3. **Hapus `chooseHeroSource`, `heroFromSegments`, `noSafeHero`, wiring 505081c.** Bukti:
   `grep -rn "chooseHeroSource\|HeroCandidate\|heroFromSegments\|noSafeHero" src/ scripts/` = NONE.
   `hyperframesRender` kini selalu broll-dulu-lalu-segment (urutan 45fd784), param heroFromSegments dibuang.
4. **`brandKit.footageGuardMode`: observe | hero-only | full. Default observe.** Nilai tak dikenal -> observe.
5. **Observe = identik 45fd784 + log.** Mode observe: `applyFootageGuard` return `changed:false`,
   footage/segments/heroTags/QC/render/fallback TIDAK diubah. Hanya push `autoFixLog`
   `step:"footage_guard"` berisi hero, dropped (+alasan per sumber), kecukupan footage, domain.
6. **hero-only & full dibuat tapi tak aktif tanpa setting brand.** Blok apply hanya jalan kalau
   `guardMode !== "observe"`; default observe -> jalur ini MATI di prod. (ponytail: reorder dalam
   masing-masing daftar; hero lintas-sumber ke posisi-0 perlu unified clip list, ditunda sampai ada
   brand aktifkan mode -> lihat komentar kode.)
7. **Tes.** `applyFootageGuard` = fungsi murni. verify-hero-selection.ts tes 23 (observe tak ubah
   order/heroTags, changed=false), 24 (hero-only: hero depan, reel utuh), 25 (full: plan.order dipakai,
   dropped dibuang). Total 25/25 PASS.

### File berubah
- `src/lib/ai/footageDirector.ts` — hapus shim `chooseHeroSource`; tambah `GuardMode` + `applyFootageGuard` (pure).
- `src/lib/pipeline/processProject.ts` — hoist tag maps; 1 footagePlan+log+apply sebelum closure; hapus blok 505081c.
- `src/lib/render/hyperframesRender.ts` — hapus `heroFromSegments` (selalu broll-lalu-seg).
- `scripts/verify-hero-selection.ts` — +3 tes mode.

### Rencana deploy OBSERVE (saat disetujui)
1. merge `feat/hf-adoption` -> `saas-multitenant`; `kontenpilot-saas` ff-merge.
2. stop + `rm -rf .next` + build + restart; health 200.
3. Default observe -> NOL perubahan footage/QC/render. Amati log `step:"footage_guard"` beberapa hari di
   semua tenan (hero/dropped/kecukupan/domain) tanpa risiko regresi visual.
4. Baru setelah data observe sehat: aktifkan hero-only/full per-brand (brandKit) + set footageDomain per brand.

### Rollback
- `git revert 4dc326d` (atau checkout 45fd784) + rebuild -> kembali ke prod sekarang.
- Per-brand: hapus `brandKit.footageGuardMode` -> otomatis observe (nol-ubah). Tanpa redeploy.

## CHECKPOINT — feat/hf-videoplan (2026-11-04 malam)

Branch `feat/hf-videoplan` dari origin/saas-multitenant (0806f0f) + merge feat/hero-order (e436ba9) = 8e2ab7b.
Semua default OFF; pipeline produksi tidak memakai builder baru. Tidak ada deploy/merge/restart.

| Tahap | Commit | Isi | Tes |
| --- | --- | --- | --- |
| Persiapan | 8e2ab7b | merge hero-order (konflik onQueueEvent+orderedClips, keduanya dipertahankan) | hero 37/37, queue 5/5, hf-queue 10/10 |
| 4 Kontrak | f4724c6 | `src/lib/video/videoPlan.ts` + fixture 4 domain (valid + 14 mutasi rusak) | verify-videoplan 7/7 |
| 5 Shadow | fa7f510 | `videoPlanDirector.ts`, flag `VIDEOPLAN_SHADOW_ENABLED` (OFF), log `data/videoplan-shadow.jsonl` | verify-videoplan-shadow 6/6 (AI tiruan) |
| 6 Builder | 551114c | `planBuilder.ts`, field opsional buildComposition, `brandKit.videoPlanMode` (on ditolak) | verify-videoplan-builder 8/8, golden 4/4 |
| 7 Adegan | (commit ini) | `sceneLibrary.ts` 8 adegan, gaya per tone, SFX sintesis `scripts/gen-sfx.sh` | verify-scene-library 5/5 |

Berikutnya: Tahap 8 (QC pre-render `hyperframes check` + keputusan render/ulang/fallback/tolak + metrik +
skrip review frame), lalu verifikasi akhir (render uji 3 video 15–20 dtk dari fixture, HANYA di luar jam
generate produksi 23:00–02:30 WIB). Belum diverifikasi: AI Director dgn OpenAI nyata (tak ada key di
lingkungan uji), render nyata adegan baru, overflow nyata di browser.

### Update checkpoint — Tahap 8 + verifikasi akhir (2026-11-04 23:55)

| Tahap | Commit | Tes |
| --- | --- | --- |
| 8 QC/metrik | 12610bd | verify-render-qc 6/6 |
| Render fixture | 3100fb7 | — |
| Fix temuan check | c13d5cb, ce2f826 | render-qc 6/6, scene 5/5, builder 8/8 |

Render uji LOKAL (bukan worker produksi; cgroup 1 core/1.2 GB, Node 24, hyperframes 0.8.230, gsap 3.15.0 dari
paket hyperframes, font OFL -> woff2): hospitality 15.3 dtk (336 dtk render), laundry 16.0 dtk (354 dtk),
animal 17.3 dtk (384 dtk). v2: `hyperframes check` lolos ketiganya (browser jalan), tanpa unduhan font luar.
Media fixture (footage/VO/SRT project nyata) TIDAK di-commit. Plan render ditulis tangan, bukan output AI.

Sisa: caption terlalu cepat dibaca (craft line_unread, cadence builder lama), kontras #mark/kata caption di
atas footage terang (warning), hook detik 0 belum ada teks (muncul 0.55 dtk), footage tak cocok topik
(Pelangi kuliner vs kamar; animal stok bukan vampire finch), AI Director belum diuji dgn OpenAI nyata.
Berikutnya: Gerbang 3 (Agus menilai video) sebelum shadow deploy / aktivasi satu brand.
