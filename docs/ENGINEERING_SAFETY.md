# Engineering Safety — lihat dokumen master

Dokumen safety lintas-3-sistem (PMS + AI Chat + AI Content) ada di repo `agusta`
(hub/sumber kebenaran booking), supaya tidak ada 3 salinan yang bisa saling divergen.
KontenPilot sendiri TIDAK terhubung ke PMS/AI Chat (tidak ada data tamu/booking di sini),
tapi prinsip anti-bug-nya (idempotency, lock konkurensi, regression test dari insiden
nyata) sama-sama berlaku:

**`/root/agusta/docs/ENGINEERING_SAFETY.md`**
**`/root/agusta/docs/REGRESSION_CHECKLIST.md`**

Raw audit khusus repo ini (evidence file:line lengkap): `docs/_audit_kontenpilot_raw.md`
(working artifact, tidak di-commit).

Temuan tertinggi-prioritas khusus repo ini (detail di dokumen master Lampiran D #3):
**tidak ada lock yang cegah cron/manual-trigger auto-generate jalan bersamaan untuk
brand/project yang sama** — bisa dobel-biaya OpenAI/fal.ai/render kalau race terjadi.
Belum diperbaiki (audit-only fase pertama), calon kandidat utama fase perbaikan
berikutnya.
