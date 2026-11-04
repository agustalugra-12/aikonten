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
