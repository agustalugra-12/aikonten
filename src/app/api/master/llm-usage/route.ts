import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { getAdminOrNull } from "@/lib/admin";

// Pemakaian & "sisa" kredit AI (OpenAI/Gemini) utk Master Dashboard (2026-10-11). Saldo
// ASLI provider tak tersedia via API -> pemakaian dihitung dari llm_usage_log (cost_usd per
// panggilan), "sisa" dari saldo yang admin input (llm_balances, entry terbaru per provider)
// dikurangi pemakaian sejak created_at saldo itu. Hanya admin. ts di llm_usage_log = detik.
export async function GET(req: NextRequest) {
  const admin = await getAdminOrNull(req);
  if (!admin) return NextResponse.json({ error: "Akses khusus admin" }, { status: 403 });
  const now = new Date();
  const startMonth = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
  const usage = db.all(sql`SELECT provider, COALESCE(SUM(cost_usd),0) AS total, COALESCE(SUM(CASE WHEN ts >= ${startMonth} THEN cost_usd ELSE 0 END),0) AS bulan, COUNT(*) AS n FROM llm_usage_log GROUP BY provider`) as { provider: string; total: number; bulan: number; n: number }[];
  const balances = db.all(sql`SELECT provider, amount_usd, created_at FROM llm_balances b WHERE created_at = (SELECT MAX(created_at) FROM llm_balances b2 WHERE b2.provider = b.provider)`) as { provider: string; amount_usd: number; created_at: number }[];
  const balByProv = new Map(balances.map((b) => [b.provider, b]));
  const label = (p: string) => (p === "openai" ? "OpenAI (GPT)" : p === "gemini" ? "Gemini" : p);
  const byProv = new Map(usage.map((u) => [u.provider, u]));
  const provs = Array.from(new Set([...usage.map((u) => u.provider), ...balances.map((b) => b.provider)]));
  const providers = provs.map((pv) => {
    const u = byProv.get(pv) ?? { provider: pv, total: 0, bulan: 0, n: 0 };
    const b = balByProv.get(pv);
    let sisaUsd: number | null = null, terpakaiSejak: number | null = null;
    let saldo: { amountUsd: number; at: number } | null = null;
    if (b) {
      const since = db.get(sql`SELECT COALESCE(SUM(cost_usd),0) AS v FROM llm_usage_log WHERE provider = ${pv} AND ts > ${b.created_at}`) as { v: number };
      terpakaiSejak = since?.v ?? 0;
      sisaUsd = b.amount_usd - terpakaiSejak;
      saldo = { amountUsd: b.amount_usd, at: b.created_at };
    }
    return { provider: pv, label: label(pv), bulanUsd: u.bulan, totalUsd: u.total, panggilan: u.n, saldo, terpakaiSejak, sisaUsd };
  });
  return NextResponse.json({ providers });
}
