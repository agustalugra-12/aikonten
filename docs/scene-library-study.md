# Studi Variasi Antar-Video (Scene Library)

Status: **studi rancangan — read-only, tanpa perubahan kode.** Basis: `saas-multitenant` @0d056ab + `feat/motion-pack-1` @63046a0.

Masalah: video dalam SATU brand terasa seragam karena polanya selalu sama (hook → caption → stat → CTA).
Motion Pack 1 membedakan **antar brand** (tone premium/friendly/playful), **bukan antar video**.

**Temuan utama:** perpustakaan adegan + urutan data-driven **SUDAH ADA** di jalur VideoPlan (Tahap 7) dan
sudah tersambung ke `buildComposition` sebagai `layers`. Yang belum ada bukan "scene library", tapi
**pemilih POLA URUTAN per video** — dan gerbang aktivasinya masih dikunci.

---

## 1. Di mana urutan adegan ditentukan sekarang?

Ada **dua jalur**. Yang dipakai produksi hari ini = jalur lama (dipaku keras). Jalur VideoPlan sudah
data-driven tapi masih OFF.

### 1a. Jalur LAMA (default + fallback) — urutan **DIPAKU KERAS** di `buildComposition`
`src/lib/render/hyperframesComposition.ts`:

| Elemen | Baris | Cara ditentukan |
|---|---|---|
| Durasi/posisi hook intro | `:88` `introSeconds = 3`, `:110` `total = introSeconds + audioDurationSeconds`, `:188-189` fade di `introSeconds-0.3` | **konstanta** |
| Urutan & panjang klip | `:56-84` `tileClips()` (round-robin antar klip), `:131` `tileMax` dari `pacing`, `:66` `MAX_TILES = 18` | algoritme tetap |
| Kartu stat | `:218` `base = introSeconds + audioDurationSeconds*0.20`, `:219` `slot = (audioDurationSeconds*0.58)/n` | **fraksi tetap** (20%–78%) |
| Lower third | `:212` `lt = introSeconds + (atSeconds ?? 1.5)` | default tetap |
| CTA | `:257` `ctaStart = total - 2.6` | **konstanta** |
| Caption | `:194-210` mengikuti `wordTimings` | data (VO), bukan struktur |

→ Rangka **hook → caption → stat(20%..78%) → CTA(2,6s terakhir)** sama untuk setiap video.
Yang sudah bisa digerakkan dari luar hanya tiga input: `:29 transitions[]`, `:30 tileMax`, `:32 busy`, `:33 layers`.

### 1b. Jalur VideoPlan — urutan **SUDAH DATA-DRIVEN**
- `src/lib/video/videoPlan.ts`: `VideoPlan.scenes: Scene[]` → **array berurutan** = urutan adegan.
- `src/lib/video/planBuilder.ts:35` `planWindows(plan, audioDur, words, beat)` → ubah urutan adegan jadi jendela waktu.
- `planBuilder.ts:71` `buildCompositionFromPlan()` → `:210` `renderScene(win.scene, ctx)` per adegan →
  dikumpulkan jadi `layers` → `:266` disuntik ke `buildComposition({ transitions, tileMax: 99, busy, layers })`.
- Jalur ini bahkan **mematikan intro lama**: `planBuilder.ts:246` `#introLayer{display:none;}`.

---

## 2. Tata letak yang SUDAH didukung hari ini (nyata di kode)

`src/lib/video/sceneLibrary.ts` — `renderScene()` (`:148`) punya **8 renderer adegan nyata**:

| Adegan | Baris | Tata letak nyata |
|---|---|---|
| `hook` | `:161` (+ `hookLayer`, planBuilder `:206`) | teks besar di zona aman, menghindari subjek (`box`/`avoid`) |
| `footage-caption` | `:165` | footage full-bleed + caption |
| `stat` | `:183` | kartu angka + label, opsional **bar chart** (`chart?: number[]`) |
| `testimonial` | `:202` | blok kutipan + penulis + rating |
| `feature-list` | `:212` | judul + 2–4 butir |
| `before-after` | `:225` | dua klip berlabel (sebelum/sesudah) |
| `cta` | `:265` | CTA + sub, dengan dim overlay (planBuilder `:214`) |
| `logo-outro` | `:275` | wordmark + tagline, memakai ulang `ctaText` |

Infrastruktur pendukung yang juga sudah ada:
- `:120` `designBg()` — latar desain untuk adegan **tanpa footage cocok** (flag `design`).
- `:299` `flashLayer()` — overlay transisi **flash**.
- `:89` `safeArea()`, `:62` `fitFont()`, `:69` `estLines()` — **title-safe + auto-fit** tipografi.
- `:28-56` `contrast()/pickInk()/accentOr()/designBase()` — penjaga **kontras WCAG ≥ 4.5**.
- `:13` `SceneCtx.variant: number` dan `:158` `align = c.variant % 2 ? "left" : "center"` — **mekanisme varian sudah ada** (diseed di planBuilder `:210` `variant: (seed >> i) & 1`).

Dari komposisi lama (selalu tersedia): footage layar penuh (`.clipwrap/.bg`), caption di atas footage
(`.capgroup`), lower third (`#lt`), kartu stat (`.statCard`), callout tengah besar (`.callout`),
CTA pill (`#cta`), **teks-saja tanpa footage** (`#facelessBg` + `.blob`, aktif saat `:129 faceless`),
progress bar (`.bar`), brand mark (`.mark`), grade + vignette.

---

## 3. Apa persisnya yang dihasilkan VideoPlan sekarang?

**Sudah punya konsep adegan penuh**, bukan sekadar mengatur hal lain. Bentuk datanya (`videoPlan.ts`):

```ts
SCENE_TYPES = ["hook","footage-caption","stat","testimonial","feature-list","before-after","logo-outro","cta"]
TONES       = ["premium","friendly","playful","corporate"]
TRANSITIONS = ["cut","crossfade","slide","zoom","whip","flash"]

type Base  = { id: string; duration: number; transition: Transition; subject?: string }
type Scene = HookScene | FootageCaptionScene | StatScene | TestimonialScene
           | FeatureListScene | BeforeAfterScene | LogoOutroScene | CtaScene

type VideoPlan = {
  version: 1
  orientation: "portrait"|"landscape"|"square"
  look: "clean"|"cinematic"|"warm"|"cool"|"vivid"|"mono"
  pacing: "fast"|"medium"|"calm"
  music: { mood: ...; volume: number }
  brand: { tone: "premium"|"friendly"|"playful"|"corporate" }
  scenes: Scene[]          // ← URUTAN ADEGAN
}
```

Pengaman yang sudah jalan:
- Validator **murni** (tanpa I/O) + `FORBIDDEN` regex → AI **tak boleh** mengirim HTML/CSS/JS/URL/warna/font.
- `LIMITS`: adegan 3–12, total 5–90s, per-adegan 0,8–8s, hook 1,2–4s, batas karakter/kata per field,
  `featureItems` 2–4, `chart` 2–6, `footageRef` wajib ada di `ctx.footageIds`.

**Statusnya: masih OFF di gerbang brand.**
- `src/lib/render/brandKit.ts:122` `videoPlanMode?: "off"`;
  `:311` validator **menolak** nilai selain `"off"` → *"videoPlanMode harus 'off' (aktivasi VideoPlan menunggu approval)"*.
- `src/lib/video/videoPlanDirector.ts:91` `shadowEnabled = env.VIDEOPLAN_SHADOW_ENABLED === "1"`;
  `:97` `if (!shadowEnabled) return null` → saat ini **hanya mode shadow** (mengumpulkan rencana, tak dipakai render).

---

## 4. Perubahan TERKECIL untuk urutan + tata letak bervariasi per video

### Sudah bisa dipakai SEKARANG — tanpa kode baru
1. **Urutan adegan** — `plan.scenes[]` sudah menentukan urutan; `planWindows` + `renderScene` sudah merakitnya.
2. **8 tata letak adegan** sudah ada (§2) — tak perlu bikin layout baru.
3. **Transisi per-klip** sudah diterima komposisi lama (`:29 transitions[]`) — variasi transisi per video sudah mungkin bahkan tanpa VideoPlan.
4. **Cadence potongan** sudah bervariasi via `pacing`/`tileMax` (`:131`).
5. **Varian tata letak** sudah ada 1 bit (`sceneLibrary.ts:158`, seed di `planBuilder.ts:210`).
6. **Motion Pack 1** (`63046a0`) sudah memberi motion tone-aware + intensity + toggle per-motion.

### Yang benar-benar perlu DIBANGUN (kecil, aditif)
1. **Buka gerbang VideoPlan untuk satu brand pilot** — `brandKit.ts:311` saat ini menolak selain `"off"`.
   Perlu pelebaran satu baris (`"off" | "on"`) + approval. **Ini blocker terbesar, dan sengaja dikunci.**
2. **Pemilih POLA URUTAN** — hari ini tak ada apa pun yang memvariasikan *template urutan* antar video
   satu brand. Cukup satu fungsi murni `pickPattern(seed) → SceneType[]` yang diumpankan ke prompt planner
   + divalidasi. Seed dari `hash(brandId + tanggal + pillar)`.
3. **Perlebar `variant`** dari 1 bit → 2–3 bit (posisi kartu, ukuran, aksen) di `SceneCtx`. Aditif, murni.
4. **(Opsional) Aturan anti-ulang** — tolak rencana yang polanya sama dengan video sebelumnya di brand itu
   (presedennya sudah ada: `contentSimilarity`/`contentFatigue`).

**Tidak perlu:** layout baru, jalur render baru, perubahan Motion Pack, perubahan FFmpeg/HyperFrames.

---

## 5. Perpustakaan adegan — 7 jenis (dengan motion Motion Pack yang cocok)

Motion Pack 1 tersedia: `punchIn`, `whipPan`, `flash`, `textReveal`, `countUp`, `lowerThirdInOut`.

| # | Adegan | Tata letak | Durasi khas | Motion Pack |
|---|---|---|---|---|
| 1 | **Hook** | footage full-bleed + teks besar di zona aman (hindari subjek) | 1,2–3 s | `punchIn` (intensitas rendah) + `textReveal` cepat; `flash` **hanya** tone playful |
| 2 | **Footage-caption** | footage full-bleed + caption kata-per-kata di bawah | 2–5 s | `punchIn` atau `whipPan` saat masuk |
| 3 | **Stat** | kartu angka + label di atas footage ter-dim / `designBg`; opsional bar chart | 1,5–3 s | `countUp` + masuk/keluar gaya `lowerThirdInOut` |
| 4 | **Feature-list** | 2–4 butir ber-stagger di `designBg` atau footage ter-dim | 2,5–5 s | `textReveal` (stagger per butir) |
| 5 | **Testimonial** | blok kutipan + penulis + rating, latar desain | 2,5–5 s | `textReveal` lambat + `lowerThirdInOut` |
| 6 | **Before-after** | dua klip berlabel (berurutan/split) | ≥ 2 s (batas `LIMITS`) | `whipPan` di titik tukar; `flash` hanya playful |
| 7 | **CTA + logo-outro** | CTA pill + wordmark + tagline, dim overlay | 2–3 s | `lowerThirdInOut` + `punchIn` lembut |

Catatan: ketujuhnya **sudah punya renderer** (§2) — ini kurasi, bukan pembangunan baru.

---

## 6. Tiga pola urutan (supaya satu brand tak selalu sama)

Semua di dalam `LIMITS` (3–12 adegan, hook 1,2–4 s, total ≤ 90 s).

**Pola A — "Bukti di depan"** (FAQ/edukasi/harga)
`hook → stat → footage-caption → feature-list → cta+logo-outro`
Angka muncul dini untuk kredibilitas; cocok konten informatif.

**Pola B — "Jalan cerita"** (suasana/tur/pengalaman)
`hook → footage-caption ×2–3 (subjek berbeda) → testimonial → cta+logo-outro`
Footage mendominasi, tanpa kartu di tengah → terasa sinematik, bukan presentasi.

**Pola C — "Kontras"** (transformasi/perbandingan)
`hook → before-after → stat → footage-caption → cta+logo-outro`
Memakai `before-after` sebagai tulang punggung; paling berbeda secara visual dari A dan B.

**Aturan rotasi (fungsi murni, mudah dites):**
`pattern = PATTERNS[hash(brandId + tanggalISO + pillar) % 3]`, dengan larangan memakai pola yang sama
dengan video sebelumnya di brand itu. Tone (Motion Pack) tetap mengurus rasa **antar brand**;
pola urutan mengurus variasi **antar video**.

---

## Risiko & batasan

- Mengaktifkan VideoPlan mengubah output render nyata → **wajib per-brand, default-off, satu brand pilot dulu**,
  dan `brandKit.ts:311` memang sengaja menolak sampai ada approval.
- `before-after` dan `testimonial` butuh dua footage cocok / kutipan asli; kalau tak ada,
  `designBg` (`:120`) jadi jaring aman — tapi terlalu sering adegan desain membuat video terasa seperti slide.
- Jangan tambah motion yang memaksa `data-motion-blur="on"` (jalur screenshot mahal) — aturan Motion Pack tetap.
- Variasi urutan menaikkan ragam, bukan mutu naskah. Mutu hook tetap ditentukan modul penulis
  (`generateContent.ts`, prompt hook stabil sejak 2026-08-06).
