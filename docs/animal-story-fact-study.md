# Studi: Label Salah Fakta — Animal Story & Co

Status: **studi read-only. Tanpa build, tanpa render, tanpa perubahan kode.** Basis `saas-multitenant` @0d056ab.
Brand: `brand_Wo1tv4SSj_ac`, brandKit = `{"renderEngine":"hyperframes","look":"cinematic","footageDomain":"animal"}`.

**Kesimpulan di depan:** fakta hewan **ditulis bebas oleh model dari pengetahuan parametriknya** — tanpa
retrieval, tanpa Knowledge Base, tanpa pencarian. Label on-screen adalah **hop LLM kedua** yang memadatkan
naskah itu. **Tidak ada satu pun pemeriksaan yang memblokir**: yang berbasis KB mengembalikan `null` untuk
brand ini, dan yang ada hanya self-critique *warning-only* yang **memburu angka/superlatif** — padahal
kesalahan nyata brand ini **tanpa angka sama sekali**. Jadi benar: **footage guard tidak menyentuh masalah ini**,
dan konten lama Animal Story **belum boleh dirender ulang**.

---

## 1. Dari mana fakta & label hewan berasal?

**Ditulis bebas oleh model.** Bukan dari pencarian, bukan dari KB.

Jalur naskah (`src/lib/ai/youtubeEditorial.ts`):
- `dailyContentPlanner.ts:5` → `generateYoutubeDailyIdeas` / `generateLongFormPackage`
- `generateLongFormPackage()` → `pickNextTopic()` → **`generateLongFormScript(channelProfile, topic, recentScripts)`**
- Naskah dipakai **apa adanya** sebagai narasi voiceover (komentar di atas `generateLongFormPackage`:
  *"Return `idea` (skrip lengkap - dipakai APA ADANYA sbg naskah voiceover"*).
- **Tidak ada grounding**: `youtubeEditorial.ts:29` — *"Model konten TOTAL BEDA dari sistem ide generik
  (`researchTopics.ts`, dipakai Pelangi/…)"*; `:34` *"bukan menambal researchTopics.ts"*. Jadi jalur riset
  Pelangi **tidak** dipakai di sini.
- Dinyatakan eksplisit di kode: `youtubeEditorial.ts:493-494` — *"konten dokumenter animal facts **TIDAK PUNYA
  knowledge base internal** spt itu (faktanya pengetahuan umum, bukan data properti)"*.

Jalur **LABEL yang muncul di video** (hop LLM kedua, dari naskah):
- `src/lib/ai/statExtractor.ts:45` `extractStatOverlays(script)` → `{label, value}`,
  prompt `:60` *"give a short label (1-3 words, e.g. \"Top Speed\", \"Weight\", …)"* → kartu stat di video.
- `src/lib/ai/lowerThirdExtractor.ts:13` `extractLowerThird(script)` → lower third.

→ **Dua hop generatif berturut-turut, nol sumber kebenaran eksternal.** Hop kedua memadatkan nuansa
naskah menjadi label 1–3 kata yang terdengar pasti.

**Tambahan penting:** label hasil render **tidak pernah disimpan**.
`SELECT COUNT(*), SUM(scene_manifest NOT NULL) FROM projects WHERE brand_id='brand_Wo1tv4SSj_ac'`
→ **515 total, 0 punya scene_manifest**. Jadi tak ada jejak audit apa pun tentang label yang benar-benar tampil.

---

## 2. Apakah ada pemeriksaan kebenaran di jalur itu?

**Tidak ada yang memblokir. Praktisnya: tidak ada pemeriksaan kebenaran.**

| Mekanisme | Baris | Kenyataan untuk Animal Story |
|---|---|---|
| `factCheckCaption(caption, knowledgeBase)` | `factCheck.ts:30`, dipanggil `processProject.ts:367` & `:1100` | Butuh **Knowledge Base brand**; **return `null`** kalau brand tak punya KB (`:27`). Hasil hanya **disimpan** (`:395-396`, `:1149-1150`) — **tak ada cabang yang menolak**. |
| `reviewScriptFactualRisk(script)` | `youtubeEditorial.ts:501`, dipakai `:538` | **WARNING-ONLY**, dinyatakan 3×: `:74`, `:491`, dan `:497` *"**TIDAK memblokir apa pun**, cuma dicatat spy Agus bisa cek manual"*. Gagal → `return []` (**fail-open**). |
| `prePublishQC` | `prePublishQC.ts:12-14` | Hanya **laporan**, bukan gerbang. |
| `editorialPreflight` | `editorialQc.ts:11`, dipakai `processProject.ts:1531` | Memeriksa hook-kamar-mandi & caption-angka-garbage. **Tidak menerima naskah maupun label** → tak bisa menilai fakta. |

**Bukti dari DB** (`projects`, brand Animal Story):
```
fact_check_confidence NULL + fact_check_flags NULL : 511 baris
fact_check_confidence = 100 (flags NULL)           :   4 baris
```
→ **511 dari 515 (99,2%) tanpa data fact-check sama sekali** — konsisten dengan `factCheckCaption` yang
mengembalikan `null` karena tak ada KB.

**Bug wiring yang nyata:** flags self-review **ada**, tapi mendarat di `projects.youtube_metadata.factCheckFlags`
(`youtubeEditorial.ts:74`, `:554`) — **bukan** di kolom `projects.fact_check_flags`. Sementara laporan QC
membaca kolom `factCheckFlags` (`prePublishQC.ts:41`). Jadi flag yang sudah dihasilkan **tak pernah muncul
di laporan QC**. Contoh nyata isi flags dari DB:
```
["bioluminescent creatures emit light that's up to 98% efficient",
 "The majority of bioluminescent species actually reside in this sunless realm",
 "Fossil records suggest that bioluminescent beetles existed tens of millions of years ago", …]
["the leaf-tailed gecko…mimicking the exact appearance of dead foliage",
 "camouflage has evolved independently across almost every branch of the animal kingdom", …]
```
Detektornya **bekerja untuk angka** — tapi tak terlihat oleh siapa pun, dan tak memblokir.

---

## 3. Lima contoh nyata dari DB

Label on-screen tak dipersist (§1), jadi kolom "label" di bawah = label yang **akan** dihasilkan
`extractStatOverlays`/`extractLowerThird` dari naskah itu (hop kedua), bukan arsip.

| # | id | status | naskah (awal) | penilaian |
|---|---|---|---|---|
| 1 | `proj_DgZtwvN5Y-PC` | published | "Why do young predators turn hunting into a playful game…" | ✅ **Benar.** Perilaku bermain pada predator juvenil terdokumentasi baik; klaim kualitatif. |
| 2 | `proj_lrtRKyR0KBvI` | published | "venom… a masterfully engineered tool designed by evolution to hunt with surgical precision… not merely as a weapon of defense" | ⚠️ **Batas/over-claim.** Framing teleologis ("designed by evolution") + generalisasi lintas semua hewan berbisa. Pada banyak taksa bisa memang untuk menangkap mangsa, tapi pada banyak lain **defensif**. Tidak salah telak, tapi digeneralisasi. |
| 3 | `proj_P2Ef2iYJlxXx` | ready | "locusts start out as lonely grasshoppers… transform into a roaring swarm… travel hundreds of miles" | ✅ **Benar.** Ini polifenisme fase belalang (solitarious → gregarious); swarm memang menempuh jarak jauh. |
| 4 | `proj_Qr07naXYPFyp` | ready | "**Unlike adults, baby dolphins don't snooze with one half of their brain at a time.** Instead, they take quick naps…" | ❌ **SALAH FAKTA.** Membalik temuan mapan: pada cetacea, tidur **unihemisfer** adalah pola umum, dan neonatus justru dilaporkan **nyaris tanpa tidur konvensional** sambil terus bergerak dekat induk. Klaim "bayi TIDAK unihemisfer, hanya tidur sebentar-sebentar" = inversi. **Dan bertentangan dengan video brand ini sendiri (#5).** |
| 5 | `proj_i0lvz2zcS3nm` | published | "**Whales** … use something called unihemispheric sleep—where one half of their brain sleeps…" | ❌ **OVER-GENERALISASI TAKSON.** Tidur unihemisfer terdokumentasi kuat pada **odontoceti** (dolphin/orca). Untuk **mysticeti** (paus balin) tidak mapan. Menyebut "Whales" sebagai blanket = klaim melampaui bukti — dan label 1–3 kata akan memadatkannya jadi "Whales / Unihemispheric Sleep" yang terdengar pasti. |

Catatan: **tak satu pun** dari #4/#5 mengandung angka → `fc_conf = -1` (NULL) dan tak ada flag untuk keduanya.

---

## 4. Apakah kesalahan itu berpola? — **Ya, sangat**

Polanya **bukan angka**, dan **bukan** ketidakcocokan footage:

1. **Over-generalisasi takson** — sifat satu klad dinyatakan untuk kelompok lebih luas
   (odontoceti → "Whales"). (#5)
2. **Inversi subjek / tahap hidup** — sifat ditukar antara dewasa vs anak, atau antar spesies. (#4)
   Sering lewat konstruksi retoris **"Unlike X, Y does not…"** — bentuk yang enak buat hook, rawan salah.
3. **Kontradiksi antar-video dalam satu brand** — #4 vs #5 saling bertentangan; tak ada pemeriksaan
   konsistensi lintas konten (padahal `contentSimilarity`/`contentFatigue` sudah ada presedennya).
4. **Diperkuat di hop label** — `extractStatOverlays` memadatkan nuansa jadi label 1–3 kata yang pasti;
   kaveat ("hanya pada odontoceti") hilang total.
5. **Tak terlihat setelahnya** — label tak dipersist (0/515 scene_manifest) → mustahil diaudit.

**Akar kebutaannya:** prompt self-review (`youtubeEditorial.ts:502-507`) meminta model menandai
*"exact statistics, superlatives…, specific numbers"* dan **secara eksplisit mem-whitelist**
*"Reply with an EMPTY array if the script only contains safe, well-established, **qualitative** facts"*.
Kesalahan #4 dan #5 justru **kualitatif dan tanpa angka** → **lolos by design**. Detektornya salah sasaran.

---

## 5. Perbaikan TERKECIL

### A. Cukup ubah PROMPT (tanpa gerbang baru, tanpa infra)
1. **Aturan cakupan takson** di `generateLongFormScript`: bila sifat spesifik-klad, **sebut kladnya**
   ("toothed whales/dolphins"), bukan kelompok luas; larang menyatakan sifat untuk takson luas kecuali
   berlaku di seluruh takson itu.
2. **Perbaiki sasaran self-review** (`youtubeEditorial.ts:502-507`): hapus whitelist "qualitative facts",
   tambahkan kelas kegagalan nyata → **over-generalisasi takson**, **atribusi tahap hidup/spesies**, dan
   klaim kontras **"Unlike X, Y does not…"**. Satu edit prompt, panggilan LLM sama, nol infra baru.
3. **Prompt `statExtractor`** (`:60-67`): subjek label **wajib sama** dengan spesies yang disebut naskah;
   larang memperluas (mis. "dolphin" → "whale").

### B. Butuh gerbang / wiring baru
4. **Sambungkan flag self-review ke laporan QC** — sekarang tersimpan di `youtube_metadata.factCheckFlags`
   sedangkan `prePublishQC.ts:41` membaca kolom `factCheckFlags`. Perbaikan wiring kecil (salin ke kolom,
   atau baca keduanya) → flag yang sudah ada **akhirnya terlihat**.
5. **Persist label render** (statOverlays + lowerThird) — 0/515 saat ini; tanpa ini kelas kesalahan ini
   tak bisa diukur maupun ditagih.
6. **Perluas `editorialQc`** dengan cek label-vs-naskah/footage (§6).
7. *(Lebih besar, opsional)* **grounding nyata**: KB fakta hewan agar `factCheckCaption` berhenti `null`,
   atau verifikasi dua-model/manusia untuk klaim ber-takson. Ini satu-satunya yang benar-benar menilai
   **kebenaran**, bukan bentuk.

**Urutan paling hemat: 2 → 1 → 3 (prompt) lalu 4 → 5 (wiring/audit), baru 6.** Butir 1–3 saja sudah
menutup sebagian besar #4/#5 tanpa kode gerbang baru.

---

## 6. Bisakah `editorialQc` diperluas untuk menangkap ini?

**Sebagian besar: YA — dan logika tersulitnya SUDAH ADA.** Tapi satu bagian di luar jangkauannya.

**Cocok secara arsitektur:** `editorialQc.ts:11 editorialPreflight()` sudah berjalan **sebelum render**
(`processProject.ts:1531`), sudah punya severity `reject | warn` (`:7`), dan sudah melakukan cek bergaya
*teks-vs-footage* (hero kamar mandi, `:19-23`).

**Yang perlu ditambah:** saat ini ia hanya menerima `{hasFootage, heroTags, captionWords, hookText}`
(`:11-16`) — **tanpa naskah dan tanpa label**. Perlu pelebaran signature di `processProject.ts:1531`
agar menerima `script` + stat/lowerThird yang sudah di-resolve.

**Logika over-claim spesies sudah dibangun** di commit **`a228e1d`** ("label jujur spesies"):
`src/lib/video/footageFit.ts` menambahkan `SPECIFIC_SPECIES` (~110 spesies) + `subjectTokens(s,{literal})`
dengan aturan — dikutip dari diff-nya:
> *"label boleh mengklaim SPESIES spesifik yg tak ada di klip ('VAMPIRE FINCH, GALAPAGOS' di klip burung
> generik; 'PECKS LARGER SEABIRDS' di klip gagak). subjectScore pakai sinonim PAYUNG (finch/seabird → 'burung'),
> jadi klip burung generik 'cocok' klaim finch. Untuk LABEL, sebut spesies spesifik → WAJIB terbukti LITERAL
> di metadata isi klip."*

→ Ini **persis kelas kesalahan** yang ditanyakan. **MASALAHNYA: fix itu hidup di jalur VideoPlan, dan
VideoPlan masih OFF** (`brandKit.ts:311` menolak `videoPlanMode` selain `"off"`). Jadi perlindungan itu
**tidak melindungi render produksi hari ini**. Memindahkan/meminjam `SPECIFIC_SPECIES` + `subjectTokens(literal)`
ke `editorialQc` adalah jalan terpendek agar berlaku di jalur produksi.

**Di LUAR jangkauan `editorialQc`:** apakah sebuah klaim **benar di dunia nyata** (mis. "bayi dolphin tidak
unihemisfer"). `editorialQc` adalah gerbang **konsistensi deterministik** pra-render. Kebenaran butuh
grounding/verifikasi (butir 5.7). Jadi:
- `editorialQc` **bisa** menutup: label mengklaim spesies yang tak ada di klip, label memperluas takson
  di luar yang disebut naskah, lint pola "Unlike X…" tanpa kaveat.
- `editorialQc` **tidak bisa** menutup: fakta yang salah tapi konsisten secara internal.

---

## Konsekuensi operasional

1. **Konten lama Animal Story JANGAN dirender ulang** sampai butir 5.A (prompt) + 5.B.4/5 (wiring+audit)
   beres — re-render memakai **naskah tersimpan apa adanya** (`processProject.ts:133` mewajibkan `project.script`),
   jadi klaim salah seperti #4/#5 akan **diawetkan**, cuma dengan bungkus lebih bagus.
   Ini berbeda dari brand lain, yang mutu naskahnya setara dan aman di-rescue.
2. **Dua video yang terdeteksi di §3 (#4, #5) sebaiknya ditinjau manual** — #5 sudah `published`.
3. Perbaikan paling murah dengan dampak terbesar = **satu edit prompt self-review** (butir 5.A.2),
   karena detektornya hari ini memang mengabaikan kelas kesalahan ini secara eksplisit.
