# PRD — AI Content Intelligence & Content Production System

**Version:** 2.0
**Product:** AI Content
**Status:** Product Requirement Document
**Focus:** Content Strategy, Content Planning, Content Production, Competitor Intelligence, SWOT, Performance Analytics & Continuous Optimization

> Ditulis ulang persis dari teks asli yang diberikan Agus (2026-08-14), disimpan sebagai file
> tersendiri (2026-08-18) supaya siapa pun (Claude Code, OpenCode, sesi berikutnya) bisa
> menemukan teks lengkapnya di satu tempat jelas. Status implementasi & pemecahan fase ada
> di dokumen terpisah, lihat "Dokumen terkait" di akhir file ini — JANGAN edit isi PRD di
> bawah ini untuk mencatat progres, itu tugas dokumen terpisah supaya PRD asli tetap jadi
> sumber kebenaran murni dari apa yang diminta Agus.

---

# 1. Product Vision

AI Content dikembangkan sebagai sistem yang mampu membantu digital marketing specialist menjalankan seluruh siklus produksi konten secara otomatis.

Sistem tidak hanya menghasilkan konten, tetapi harus mampu:

1. Memahami brand.
2. Menganalisis kompetitor.
3. Melakukan SWOT.
4. Menentukan strategi konten.
5. Menentukan jenis konten yang perlu dibuat.
6. Membuat content planning.
7. Membuat ide, hook, script, caption dan hashtag.
8. Memilih footage yang sesuai.
9. Menghasilkan video dengan struktur yang bervariasi.
10. Menjadwalkan dan mempublikasikan konten.
11. Membaca performa konten.
12. Membandingkan performa dengan strategi sebelumnya.
13. Menghasilkan laporan mingguan.
14. Menghasilkan laporan bulanan.
15. Menggunakan data performa sebagai input untuk strategi berikutnya.

Prinsip utama:

> **AI tidak boleh hanya menghasilkan lebih banyak konten. AI harus menghasilkan konten yang semakin relevan dan semakin baik berdasarkan data.**

---

# 2. Masalah yang Harus Diselesaikan

AI Content saat ini memiliki kemampuan produksi konten, tetapi perlu ditingkatkan agar:

* konten tidak monoton;
* format konten tidak berulang;
* hook tidak selalu sama;
* struktur video tidak selalu sama;
* footage tidak terus menggunakan aset yang sama;
* sudut pandang konten lebih beragam;
* konten mengikuti kebutuhan brand;
* strategi konten berdasarkan SWOT;
* strategi konten berdasarkan kompetitor;
* AI memahami konten mana yang performanya bagus;
* AI mengetahui konten mana yang harus dihentikan;
* client dapat melihat laporan profesional;
* content planning dapat dijadikan dokumen/PDF;
* hasil analisis dapat menjadi dasar planning bulan berikutnya.

---

# 3. Arsitektur Sistem Baru

```text
BRAND PROFILE
      ↓
BRAND KNOWLEDGE
      ↓
MARKET RESEARCH
      ↓
COMPETITOR ANALYSIS
      ↓
SWOT ANALYSIS
      ↓
CONTENT STRATEGY ENGINE
      ↓
CONTENT PILLAR
      ↓
CONTENT TYPE MIX
      ↓
CONTENT PLANNING
      ↓
IDE + HOOK + SCRIPT + CAPTION
      ↓
CONTENT PRODUCTION
      ↓
FOOTAGE INTELLIGENCE
      ↓
VIDEO STRUCTURE ENGINE
      ↓
QUALITY CONTROL
      ↓
SCHEDULER
      ↓
AUTO POSTING
      ↓
PERFORMANCE ANALYTICS
      ↓
WEEKLY REPORT
      ↓
MONTHLY REPORT
      ↓
AI LEARNING / OPTIMIZATION
      ↓
NEXT CONTENT STRATEGY
```

---

# 4. Brand Intelligence

Sebelum menghasilkan konten, AI harus memiliki Brand Profile.

## Data Brand

* Nama brand
* Industri
* Produk/service
* Target audience
* Lokasi
* Brand positioning
* Brand personality
* Tone of voice
* USP
* Harga jika relevan
* Keunggulan produk
* Kelemahan produk
* Target marketing
* Target platform
* Competitor
* Content preference
* Visual identity
* Logo
* Brand color
* Font
* CTA preference

## Brand Knowledge Base

AI dapat menyimpan:

* FAQ
* Produk
* Service
* Benefit
* Unique selling point
* Customer problem
* Customer objection
* Testimonial
* Promo
* Brand story
* Existing content
* Existing footage

AI tidak boleh mengarang informasi brand yang tidak tersedia.

---

# 5. Competitor Intelligence

Tambahkan modul khusus:

# Competitor Research

User dapat memasukkan beberapa kompetitor.

Contoh:

```text
Competitor 1
Competitor 2
Competitor 3
Competitor 4
Competitor 5
```

## Data yang dianalisis

### Content Analysis

AI menganalisis:

* frekuensi posting;
* platform;
* jenis konten;
* content pillar;
* format;
* video duration;
* hook;
* CTA;
* visual style;
* caption;
* hashtag;
* engagement;
* komentar;
* top-performing content;
* konten yang sering digunakan;
* pola posting.

### Competitor Content Gap

AI harus mencari:

> Apa yang dilakukan kompetitor?

dan:

> Apa yang belum dilakukan kompetitor?

Contoh:

```text
Competitor banyak membuat:
- edukasi
- promo
- testimonial

Competitor jarang membuat:
- behind the scenes
- myth vs fact
- customer story
- comparison
- eksperimen
```

AI kemudian memberikan peluang:

```text
CONTENT OPPORTUNITY
1. Customer Story
2. Myth vs Fact
3. Behind The Scene
4. Educational Series
5. Comparison
```

---

# 6. Competitor Dashboard

Buat tabel:

| Competitor | Platform | Followers | Posting Frequency | Engagement | Top Content | Weak Content | Opportunity |
| ---------- | -------: | --------: | -----------------: | ---------: | ----------- | ------------ | ----------- |

Tambahkan:

### Competitor Content Matrix

AI mengelompokkan konten kompetitor berdasarkan:

* Education
* Entertainment
* Promotion
* Storytelling
* Social Proof
* Product
* Community
* Trend
* FAQ
* Authority

Tujuannya bukan meniru kompetitor.

Prinsip:

> **Learn → Identify Gap → Create Differentiation**

---

# 7. SWOT Intelligence Engine

AI harus menghasilkan SWOT secara otomatis.

## Strength

Contoh:

* USP kuat
* harga kompetitif
* visual bagus
* lokasi strategis
* customer review tinggi

## Weakness

Contoh:

* brand awareness rendah
* konten kurang konsisten
* visual belum kuat
* sedikit social proof

## Opportunity

Contoh:

* competitor gap
* trend content
* search demand
* audience question
* emerging topic

## Threat

Contoh:

* kompetitor lebih aktif
* perang harga
* trend berubah
* audience saturation

---

# 8. SWOT → Content Strategy

Ini bagian penting.

SWOT tidak boleh berhenti sebagai laporan.

AI harus mengubah SWOT menjadi tindakan.

Contoh:

### Weakness

Brand kurang dikenal.

AI menghasilkan:

```text
Strategy:
Increase Authority + Brand Awareness
```

Content mix:

* Educational
* Authority
* Founder Story
* Behind The Scene
* FAQ
* Social Proof

---

### Strength

Produk memiliki keunggulan tertentu.

AI menghasilkan:

```text
Strategy:
Product Differentiation
```

Content mix:

* Product Demonstration
* Comparison
* Before/After
* Case Study
* Customer Result

---

### Opportunity

Audience banyak bertanya mengenai suatu masalah.

AI menghasilkan:

```text
Strategy:
Problem-Based Content
```

Content mix:

* Problem/Solution
* FAQ
* Myth vs Fact
* Tips
* Tutorial

---

# 9. Content Type Intelligence

AI harus memiliki banyak jenis konten.

Jangan hanya:

```text
Tips
Tips
Tips
Tips
Promo
Tips
Tips
```

Gunakan Content Type Library.

## A. Educational

* Tips
* Tutorial
* How To
* Step-by-Step
* Beginner Guide
* Advanced Guide
* Checklist
* Mistakes
* Do & Don't
* FAQ

## B. Authority

* Expert Opinion
* Industry Insight
* Data
* Research
* Case Study
* Analysis
* Prediction
* Trend Explanation

## C. Storytelling

* Brand Story
* Founder Story
* Customer Story
* Problem → Journey → Result
* Behind The Scene
* Day In The Life
* Transformation Story

## D. Engagement

* Question
* Poll
* This or That
* Quiz
* Guess
* Challenge
* Hot Take
* Agree/Disagree
* Comment Bait yang relevan

## E. Product

* Product Showcase
* Product Demonstration
* Product Feature
* Product Benefit
* Product Comparison
* Before/After
* Use Case
* Product FAQ

## F. Social Proof

* Testimonial
* Customer Review
* Customer Story
* Case Study
* Result
* UGC-style content

## G. Promotional

* Soft Selling
* Hard Selling
* Limited Offer
* Bundle
* Promo
* Seasonal Campaign

## H. Entertainment

* Relatable
* Meme
* Humor
* Unexpected Fact
* Reaction
* Trend
* Story Twist

## I. Community

* Customer Question
* Customer Spotlight
* Community Story
* User Problem
* Audience Request

---

# 10. Content Mix Engine

AI harus menentukan persentase content type berdasarkan:

* objective;
* SWOT;
* competitor gap;
* audience;
* platform;
* historical performance.

Contoh:

```text
Education       30%
Storytelling    15%
Authority       15%
Product         15%
Social Proof    10%
Entertainment   10%
Promotion        5%
```

Namun persentase **tidak boleh hardcoded**.

AI harus dapat mengubahnya berdasarkan data.

---

# 11. Anti-Monotony Engine

Ini adalah fitur wajib.

AI harus mempunyai:

# Content Diversity Engine

Setiap konten mendapatkan metadata:

```text
content_type
content_pillar
topic
angle
hook_type
script_structure
visual_style
footage_category
CTA_type
tone
duration
platform
```

AI harus mengecek konten sebelumnya sebelum membuat konten baru.

---

# 12. Repetition Detection

Sistem harus mendeteksi:

### Topic repetition

Jika topik sama terlalu sering:

```text
WARNING:
Topic similarity 82%
```

### Hook repetition

Jika hook terlalu mirip:

```text
WARNING:
Hook pattern used 3 times in previous 7 posts.
```

### Structure repetition

Jika struktur video sama:

```text
WARNING:
Problem → Solution structure used repeatedly.
```

### Visual repetition

Jika footage yang sama terlalu sering digunakan:

```text
WARNING:
Footage asset used 4 times in recent content.
```

### CTA repetition

AI juga harus menghindari:

```text
"Follow untuk tips..."
```

digunakan terus-menerus.

---

# 13. Content Rotation Engine

AI membuat rotasi otomatis.

Contoh:

```text
Post 1
Educational + Question Hook

Post 2
Storytelling + Emotional Hook

Post 3
Product + Demonstration Hook

Post 4
Entertainment + Curiosity Hook

Post 5
Authority + Data Hook

Post 6
Social Proof + Customer Story

Post 7
Promotion + Urgency Hook
```

Dengan demikian feed terlihat lebih natural.

---

# 14. Hook Intelligence

AI harus memiliki Hook Library.

## Hook Categories

### Curiosity

> "Ada satu hal yang hampir semua orang salah pahami tentang..."

### Problem

> "Kalau kamu sering mengalami X, kemungkinan masalahnya ada di sini."

### Contrarian

> "Justru cara yang selama ini dianggap benar bisa membuat..."

### Question

> "Kenapa dua bisnis dengan produk yang sama bisa punya hasil berbeda?"

### Story

> "Awalnya kami mengira masalahnya adalah X..."

### Data

> "Sebagian besar orang tidak menyadari bahwa..."

### Warning

> "Jangan lakukan ini sebelum..."

### Direct Benefit

> "Dalam 30 detik kamu akan tahu cara..."

### Mystery

> "Ada alasan kenapa brand besar melakukan ini."

### Comparison

> "Mana yang lebih efektif: A atau B?"

### Pattern Interrupt

> "Stop. Sebelum kamu melakukan X..."

AI harus memilih hook berdasarkan:

* content type;
* audience;
* platform;
* topic;
* objective;
* previous hook performance.

---

# 15. Hook Performance Learning

Setiap hook disimpan.

Contoh:

| Hook Type | Used | Avg Views | Avg Retention | Performance |
| --------- | ---: | --------: | -------------: | ----------- |
| Curiosity |    8 |       12K |            72% | Excellent   |
| Question  |    7 |        6K |            58% | Good        |
| Data      |    5 |        4K |            51% | Average     |
| Warning   |    6 |       14K |            76% | Excellent   |

AI kemudian memprioritaskan hook yang terbukti berhasil.

---

# 16. Video Structure Engine

Video tidak boleh selalu menggunakan satu formula.

AI harus mempunyai berbagai struktur.

## Structure A — Problem → Solution

```text
Hook
Problem
Why it happens
Solution
CTA
```

## Structure B — Storytelling

```text
Hook
Situation
Conflict
Turning Point
Result
Lesson
CTA
```

## Structure C — Listicle

```text
Hook
Point 1
Point 2
Point 3
Best Point
CTA
```

## Structure D — Before / After

```text
Before
Problem
Process
After
Result
CTA
```

## Structure E — Myth vs Fact

```text
Hook
Myth
Truth
Explanation
Example
CTA
```

## Structure F — Comparison

```text
Hook
A
B
Comparison
Winner / Recommendation
CTA
```

## Structure G — Case Study

```text
Problem
Strategy
Implementation
Result
Lesson
CTA
```

## Structure H — Question Answer

```text
Question
Short Answer
Explanation
Example
CTA
```

## Structure I — Open Loop

```text
Hook
Open Loop
Context
Reveal
Lesson
CTA
```

## Structure J — Demonstration

```text
Hook
Show Product
Demonstrate
Result
CTA
```

AI harus melakukan rotation.

---

# 17. Script Generation

Setiap content plan menghasilkan:

* Content title
* Objective
* Content pillar
* Content type
* Topic
* Angle
* Hook
* Script
* Scene-by-scene structure
* Visual instruction
* Footage requirement
* Voice-over
* Subtitle
* CTA
* Caption
* Hashtag
* Recommended duration

---

# 18. Scene Planning

Video harus dibuat dalam scene.

Contoh:

```text
Scene 01 — Hook
0–3 sec
Visual: close-up product
Text: "..."

Scene 02 — Problem
3–8 sec
Visual: customer situation

Scene 03 — Explanation
8–18 sec
Visual: B-roll

Scene 04 — Solution
18–28 sec
Visual: product demonstration

Scene 05 — CTA
28–35 sec
Visual: product + brand
```

---

# 19. Footage Intelligence

Pemilihan footage tidak boleh random.

Sistem harus menggunakan:

# AI Footage Matching Engine

Setiap footage memiliki metadata:

* category;
* object;
* location;
* person;
* action;
* emotion;
* camera angle;
* camera movement;
* lighting;
* color;
* duration;
* orientation;
* quality;
* usage count;
* last used;
* semantic tags.

AI mencocokkan footage dengan scene.

---

# 20. Footage Diversity Engine

AI harus menghindari penggunaan footage yang sama.

Prioritas pemilihan:

```text
Semantic relevance
+
Visual quality
+
Scene compatibility
+
Unused asset
+
Oldest last-used date
+
Visual diversity
```

Contoh:

Jika tersedia 100 footage produk, AI tidak boleh terus memilih 5 footage terbaik yang sama.

Sistem harus melakukan rotation.

---

# 21. Visual Diversity

AI juga harus mempertimbangkan:

* close-up;
* medium shot;
* wide shot;
* overhead;
* side angle;
* product shot;
* human interaction;
* environment;
* detail shot;
* movement shot;
* static shot.

Tujuan:

> Video terasa seperti dibuat oleh content producer manusia, bukan template AI yang diulang.

---

# 22. Content Planning Engine

Dashboard Content Planning harus menjadi pusat perencanaan.

Setiap konten memiliki:

| Date | Platform | Content Type | Pillar | Topic | Hook | Structure | Script | CTA | Status |
| ---- | -------- | ------------ | ------ | ----- | ---- | --------- | ------ | --- | ------ |

AI membuat planning berdasarkan:

```text
SWOT
+
Competitor Analysis
+
Audience
+
Content Goal
+
Historical Performance
+
Content Diversity
```

---

# 23. Content Plan Detail

Saat user membuka satu content plan:

### Strategy

* Objective
* Content pillar
* Content type
* Strategic reason

### Creative

* Idea
* Angle
* Hook
* Script
* Structure
* Scene

### Production

* Footage needed
* Footage selected
* Voice
* Music
* Subtitle
* Visual instruction

### Publishing

* Platform
* Date
* Time
* Caption
* Hashtag
* CTA

---

# 24. Export Content Planning

Content planning dapat di-export menjadi:

### PDF

Isi PDF:

1. Cover
2. Brand overview
3. Marketing objective
4. SWOT summary
5. Competitor analysis
6. Content strategy
7. Content pillars
8. Content mix
9. Content calendar
10. Content ideas
11. Hooks
12. Scripts
13. Captions
14. CTA
15. Production notes

PDF harus memiliki desain profesional dan layak diberikan kepada client.

---

# 25. Weekly Performance Report

AI harus otomatis membuat laporan mingguan.

## Executive Summary

Contoh:

```text
Content Performance minggu ini meningkat 18%.

Konten dengan performa terbaik:
"3 Kesalahan..."

Insight:
Educational content dengan curiosity hook
menghasilkan retention tertinggi.
```

---

# 26. Weekly Metrics

Laporan minimal mencakup:

### Content Output

* Total content
* Published
* Failed
* Draft
* Video
* Image
* Carousel

### Reach

* Reach
* Impressions
* Views
* Unique viewers

### Engagement

* Likes
* Comments
* Shares
* Saves
* Engagement rate

### Audience

* Followers gained
* Followers lost
* Audience growth
* Audience response

### Video

* Average watch time
* Retention
* Completion rate
* 3-second view rate
* 25% / 50% / 75% / 100% retention jika tersedia

### Conversion

* Profile visits
* Website clicks
* WhatsApp clicks
* Leads
* Conversion jika datanya tersedia

---

# 27. Content-Level Report

Setiap konten harus memiliki data:

```text
Thumbnail / Foto Konten
↓
Title
↓
Date Published
↓
Platform
↓
Caption
↓
Content Type
↓
Hook
↓
Reach
↓
Views
↓
Likes
↓
Comments
↓
Shares
↓
Saves
↓
Engagement
↓
Watch Time
↓
Retention
↓
Conversion
```

User dapat membuka detail konten.

---

# 28. Weekly Report Graphs

Laporan harus memiliki grafik.

Minimal:

### Reach Trend

Grafik reach harian.

### Engagement Trend

Grafik engagement.

### Follower Growth

Grafik pertumbuhan followers.

### Content Performance

Perbandingan performa setiap konten.

### Content Type Performance

```text
Education
Storytelling
Product
Entertainment
Promotion
```

### Hook Performance

Performa berdasarkan jenis hook.

### Platform Comparison

Perbandingan:

```text
Instagram
TikTok
Facebook
YouTube
```

---

# 29. Top Content

AI menampilkan:

### Top 5 Content

Berdasarkan:

* Reach
* Engagement
* Retention
* Share
* Save
* Conversion

AI menjelaskan:

> Mengapa konten ini berhasil?

Contoh:

```text
Konten berhasil karena:
1. Hook langsung menyentuh problem.
2. Durasi 32 detik.
3. Visual berubah setiap 2–4 detik.
4. CTA tidak terlalu agresif.
5. Topic memiliki relevansi tinggi dengan audience.
```

---

# 30. Worst Content Analysis

Jangan hanya melaporkan konten terbaik.

AI juga harus menjelaskan:

> Mengapa konten ini gagal?

Analisis:

* hook;
* topic;
* structure;
* duration;
* footage;
* visual;
* caption;
* CTA;
* posting time;
* engagement.

Kemudian memberikan rekomendasi:

```text
ACTION:
Do not repeat current format.

TRY:
Use stronger problem hook
+ shorter introduction
+ faster visual transition.
```

---

# 31. Monthly Report

Laporan bulanan merupakan laporan akhir.

Isi:

## Executive Summary

* total content;
* total reach;
* total views;
* total engagement;
* follower growth;
* conversion;
* best content;
* worst content;
* overall performance.

## Strategy Evaluation

AI membandingkan:

```text
Target
vs
Actual
```

---

# 32. Monthly Content Analysis

AI menghitung:

* Content Type Performance
* Pillar Performance
* Hook Performance
* Structure Performance
* Topic Performance
* CTA Performance
* Footage Performance
* Posting Time Performance
* Platform Performance

---

# 33. Monthly Strategic Recommendation

AI menghasilkan:

### Continue

Konten yang harus diteruskan.

### Reduce

Konten yang harus dikurangi.

### Stop

Konten yang tidak efektif.

### Increase

Konten yang memiliki peluang besar.

### Test

Konten baru yang perlu diuji.

Contoh:

```text
INCREASE
Educational + Curiosity Hook

REDUCE
Generic Promotional Content

TEST
Customer Story + Emotional Hook
```

---

# 34. Monthly SWOT Update

SWOT tidak dibuat sekali.

Setiap bulan AI melakukan:

```text
Previous SWOT
+
New Performance Data
+
New Competitor Data
+
Market Changes
=
Updated SWOT
```

Dengan demikian strategi terus berkembang.

---

# 35. AI Learning Loop

Sistem harus memiliki feedback loop:

```text
CONTENT
↓
PERFORMANCE
↓
ANALYSIS
↓
WHAT WORKED?
↓
WHAT FAILED?
↓
PATTERN DETECTION
↓
STRATEGY UPDATE
↓
NEXT CONTENT PLAN
```

AI harus dapat menjawab:

> "Konten seperti apa yang paling efektif untuk brand ini?"

berdasarkan data aktual, bukan asumsi.

---

# 36. Content Intelligence Score

Setiap konten mendapatkan score.

Contoh:

```text
Strategy Fit       92
Hook Quality       88
Content Diversity  90
Visual Quality     86
Brand Fit          95
CTA Quality        82
Production Quality 91
----------------------
Overall Score      89/100
```

Konten dengan score terlalu rendah dapat masuk ke Quality Control.

---

# 37. Pre-Publishing Quality Control

Sebelum upload AI melakukan pemeriksaan:

### Content

* apakah relevan?
* apakah sesuai brand?
* apakah sesuai objective?
* apakah terlalu mirip konten sebelumnya?

### Hook

* apakah kuat?
* apakah jelas?
* apakah terlalu sering digunakan?

### Script

* apakah ada struktur?
* apakah value jelas?
* apakah terlalu panjang?

### Visual

* apakah footage relevan?
* apakah footage berulang?
* apakah kualitas cukup?

### Audio

* voice clarity;
* music volume;
* audio balance.

### Subtitle

* spelling;
* timing;
* readability;
* safe area.

### Branding

* logo;
* brand color;
* brand consistency.

### CTA

* relevan;
* tidak terlalu sering;
* sesuai objective.

---

# 38. Content Similarity Score

Sebelum publish:

```text
Previous Content Similarity: 34%
```

Threshold:

```text
0–40%     Safe
41–60%    Review
61–75%    High Similarity
>75%      Regenerate
```

Threshold dapat dikonfigurasi.

---

# 39. Content Fatigue Detection

AI harus mendeteksi audience fatigue.

Contoh:

```text
Topic: "Tips Marketing"

Used: 12 times / 30 days
Average Reach ↓ 31%

Recommendation:
Reduce topic frequency.
Introduce new content angle.
```

Ini penting agar AI tidak terus membuat topik yang sama hanya karena topic tersebut pernah berhasil.

---

# 40. Trend Adaptation

Jika trend relevan dengan brand:

```text
Trend detected
↓
Brand relevance check
↓
Competitor usage check
↓
Audience relevance
↓
Content opportunity
```

AI tidak boleh mengikuti semua trend.

Hanya trend yang:

* relevan;
* aman;
* sesuai brand;
* memiliki potensi.

---

# 41. Caption Intelligence

Caption tidak boleh selalu:

```text
Hook
Penjelasan
CTA
Hashtag
```

AI harus memiliki variasi:

* storytelling caption;
* educational caption;
* short caption;
* conversational caption;
* question caption;
* authority caption;
* product caption;
* emotional caption;
* SEO caption;
* CTA-focused caption.

---

# 42. Hashtag Intelligence

AI menentukan hashtag berdasarkan:

* niche;
* topic;
* location;
* product;
* audience;
* search intent.

AI menghindari penggunaan set hashtag yang sama terus-menerus.

---

# 43. Platform Adaptation

Satu ide tidak otomatis menjadi copy-paste.

AI harus melakukan adaptation.

### TikTok

Fokus:

* hook;
* retention;
* fast pacing;
* trend;
* native style.

### Instagram

Fokus:

* visual;
* saves;
* shares;
* carousel;
* Reels.

### Facebook

Fokus:

* community;
* shareability;
* storytelling;
* accessible language.

### YouTube Shorts

Fokus:

* retention;
* curiosity;
* replayability.

---

# 44. Dashboard

Dashboard utama:

```text
┌────────────────────────────────────┐
│ CONTENT PERFORMANCE                │
├────────────────────────────────────┤
│ Reach        Views       Engagement │
│ +18%         +24%        +12%       │
├────────────────────────────────────┤
│ Performance Graph                  │
├────────────────────────────────────┤
│ Top Content                        │
├────────────────────────────────────┤
│ Content Type Performance           │
├────────────────────────────────────┤
│ Hook Performance                   │
├────────────────────────────────────┤
│ Competitor Insight                 │
├────────────────────────────────────┤
│ SWOT                               │
├────────────────────────────────────┤
│ AI Recommendation                  │
└────────────────────────────────────┘
```

---

# 45. AI Recommendation Center

Tambahkan modul:

# What Should I Do Next?

AI memberikan rekomendasi praktis.

Contoh:

```text
🔥 PRIORITY

1. Buat 3 konten customer story.
Reason:
Story content memiliki engagement 42% lebih tinggi.

2. Kurangi generic promotion.
Reason:
Reach turun 28%.

3. Gunakan curiosity hook.
Reason:
Retention 17% lebih tinggi.

4. Gunakan footage category "human interaction".
Reason:
Performance lebih tinggi dibanding product-only footage.
```

Tujuan modul ini adalah membuat AI terasa seperti digital marketing specialist.

---

# 46. Content Experiment Engine

Tambahkan kemampuan eksperimen.

Contoh:

### Experiment

```text
Topic:
Cara memilih produk

Version A:
Question Hook

Version B:
Contrarian Hook
```

AI membandingkan performa.

Kemudian:

```text
Winner:
Version B

Learning:
Contrarian Hook menghasilkan retention +19%.
```

Learning disimpan untuk konten berikutnya.

---

# 47. Content Knowledge Base

Semua hasil disimpan:

```text
Brand Knowledge
Competitor Knowledge
SWOT
Content History
Hook History
Topic History
Footage History
Performance History
Experiment History
Audience Insight
```

Ini menjadi memory marketing brand.

---

# 48. Client Reporting

Client tidak perlu melihat seluruh data teknis.

Buat dua mode:

## Internal Mode

Untuk agency/admin:

* seluruh analytics;
* SWOT;
* competitor;
* AI reasoning;
* content score;
* experiments;
* production data.

## Client Mode

Lebih sederhana:

* content published;
* reach;
* engagement;
* growth;
* top content;
* monthly result;
* strategy recommendation.

---

# 49. Export Report

Support:

* PDF;
* CSV untuk data;
* content planning PDF.

Weekly PDF:

```text
Cover
↓
Executive Summary
↓
Performance
↓
Graph
↓
Top Content
↓
Worst Content
↓
Content Analysis
↓
AI Insight
↓
Next Week Recommendation
```

Monthly PDF:

```text
Cover
↓
Executive Summary
↓
Monthly KPI
↓
Performance Graph
↓
Content Analysis
↓
Competitor Insight
↓
SWOT Update
↓
Best Content
↓
Worst Content
↓
Strategy Evaluation
↓
Next Month Strategy
↓
Next Month Content Direction
```

---

# 50. Database Requirements

Minimal entities:

```text
brands
brand_knowledge
competitors
competitor_analysis
swot_analysis
content_pillars
content_types
content_plans
content_ideas
content_scripts
content_hooks
content_captions
content_assets
footage_assets
footage_usage
video_structures
content_publications
content_metrics
weekly_reports
monthly_reports
content_experiments
ai_recommendations
content_scores
```

---

# 51. Footage Database

Setiap footage harus memiliki:

```text
asset_id
filename
category
tags
objects
action
emotion
location
camera_angle
camera_movement
orientation
duration
quality_score
usage_count
last_used_at
created_at
embedding
```

Embedding digunakan untuk semantic matching.

---

# 52. AI Decision Priority

Saat menentukan konten berikutnya, AI menggunakan prioritas:

```text
1. Marketing Objective
2. Brand Strategy
3. SWOT
4. Competitor Gap
5. Audience Need
6. Historical Performance
7. Content Diversity
8. Production Availability
9. Platform Optimization
10. Trend
```

---

# 53. Anti-Monotony Rules

System wajib memenuhi:

### Topic

Tidak boleh terlalu sering mengulang topik.

### Hook

Tidak boleh menggunakan pola hook yang sama berulang kali.

### Structure

Video structure harus dirotasi.

### Visual

Footage harus bervariasi.

### Camera Angle

Angle harus bervariasi jika asset tersedia.

### Caption

Caption style harus bervariasi.

### CTA

CTA harus dirotasi.

### Content Type

Content type harus memiliki distribution.

### Duration

Durasi harus bervariasi sesuai kebutuhan konten.

### Tone

Tone dapat berubah sesuai objective.

---

# 54. Intelligent Regeneration

Jika AI mendeteksi:

```text
Similarity > threshold
```

atau:

```text
Footage repetition high
```

atau:

```text
Hook repetition high
```

maka sistem tidak hanya memberikan warning.

Sistem harus mampu:

> **Regenerate with a different creative direction.**

Contoh:

```text
Original:
Educational + Question Hook

Regenerate:
Storytelling + Curiosity Hook
```

---

# 55. Success Metrics

AI Content dianggap berhasil apabila:

### Production

* waktu produksi turun;
* jumlah konten meningkat;
* biaya produksi tetap terkendali.

### Content Quality

* content similarity rendah;
* visual diversity tinggi;
* hook diversity tinggi;
* structure diversity tinggi.

### Performance

* reach meningkat;
* engagement meningkat;
* retention meningkat;
* followers meningkat;
* conversion meningkat.

### Strategy

* SWOT digunakan dalam planning;
* competitor analysis memengaruhi content strategy;
* performance report memengaruhi planning berikutnya.

---

# 56. MVP Priority

## P0 — Wajib

1. Content planning engine
2. Competitor analysis
3. SWOT
4. Content type library
5. Anti-monotony engine
6. Hook library
7. Video structure rotation
8. Footage intelligence
9. Weekly report
10. Monthly report
11. Graph analytics
12. PDF export
13. Performance learning

## P1 — Setelah MVP

1. Content experiment
2. Content fatigue detection
3. Trend intelligence
4. Advanced competitor gap
5. AI recommendation center
6. Content score
7. Client reporting mode

## P2 — Advanced

1. Predictive content performance
2. Automated A/B testing
3. Audience segmentation
4. Predictive trend detection
5. Cross-brand learning without exposing client data

---

# 57. Core AI Prompt Logic

AI Content harus berpikir dengan pola:

```text
DO NOT ASK:
"What content should I generate?"

ASK:
"What content does this brand need next?"
```

AI harus mempertimbangkan:

```text
What is the objective?
What does the audience need?
What is the competitor doing?
What is the competitor NOT doing?
What does the SWOT tell us?
What worked previously?
What failed previously?
What has been repeated too often?
Which hook should be tested?
Which structure should be used?
Which footage has not been used?
Which visual pattern should be avoided?
What is the best next experiment?
```

---

# 58. Final Product Principle

AI Content bukan sekadar:

> **Generate → Upload**

Tetapi:

> **Research → Analyze → Strategize → Plan → Create → Publish → Measure → Learn → Optimize → Create Again**

Dan prinsip terpenting:

> **Setiap konten baru harus mempunyai alasan mengapa konten tersebut dibuat.**

AI harus mampu menjelaskan:

> "Mengapa konten ini dibuat?"

> "Mengapa menggunakan hook ini?"

> "Mengapa menggunakan struktur ini?"

> "Mengapa footage ini dipilih?"

> "Apa hubungan konten ini dengan SWOT?"

> "Apa yang dipelajari dari kompetitor?"

> "Apa yang kita pelajari dari konten sebelumnya?"

Dengan pendekatan tersebut, AI Content dapat berfungsi sebagai **digital marketing specialist + content strategist + creative planner + content producer + performance analyst** dalam satu sistem.

---

## Dokumen terkait (status implementasi, bukan bagian dari PRD asli)

- **Fase 1 (Content Diversity Engine) — spec desain**: `docs/superpowers/specs/2026-08-14-content-diversity-engine-design.md`
- **Fase 1 — plan implementasi**: `docs/superpowers/plans/2026-08-14-content-diversity-engine-plan.md`
- **Fase 1 — status: SELESAI lokal** (5 task, hookType/structureTemplate classification, weighted anti-repetition, bounded regen), belum live ke server manapun per 2026-08-18 pagi.
- **TIER 0-3 (OpenCode/Codex)**: lock verification, Content Type Taxonomy, Usage Tracking, Advanced Diversity Strategy - lihat `docs/TIER_0_VERIFICATION_REPORT.md` dan git log.
- **Catatan koordinasi kerja paralel Claude Code ↔ OpenCode**: `docs/HANDOFF_OPENCODE_2026-08-18.md`
- **Fase 2 (Competitor Intelligence + SWOT, PRD §5-8)**: BELUM ADA infrastrukturnya sama sekali per 2026-08-14, blocked pada keputusan bisnis Agus soal sumber data kompetitor (API berbayar vs manual vs AI browsing) - JANGAN dipilih sepihak.
- **Fase 3 (Analytics/Reporting penuh, PRD §25-34)**: fondasi nyata SUDAH ada (`performanceLearning.ts`, sync views/engagement per-post dari Buffer GraphQL) tapi belum weekly/monthly report, PDF export, dashboard.
