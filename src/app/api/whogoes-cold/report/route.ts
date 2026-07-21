import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Read-only daily summary of the cold-outreach run, formatted for Slack. n8n calls
// this after the discovery loop and posts `report` to the #shootday-leads channel.
// Protected by ?secret=WHOGOES_COLD_SECRET.
export const maxDuration = 60;

const IST = "Asia/Kolkata";
// en-CA renders as YYYY-MM-DD, which is what we bucket on.
const istDate = (d: string | number | Date) =>
  new Date(d).toLocaleDateString("en-CA", { timeZone: IST });

type DayStats = { companies: number; found: number; sent: number };

async function handle(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  if (!process.env.WHOGOES_COLD_SECRET || secret !== process.env.WHOGOES_COLD_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  // Aggregate in the DB (one row per IST day). A raw-row select here silently hit
  // PostgREST's row cap once the table passed ~1000 rows/2 days and dropped today's
  // rows, producing a false 0/0/0 "outage" report every day.
  const { data: dayRows, error } = await supabase.rpc("get_whogoes_cold_daily_stats", {
    p_days: 8,
  });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const today = istDate(new Date());
  const byDay = new Map<string, DayStats>();
  for (const r of (dayRows ?? []) as { ist_day: string; companies: number; found: number; sent: number }[]) {
    byDay.set(r.ist_day, { companies: r.companies, found: r.found, sent: r.sent });
  }

  const todayStats = byDay.get(today) ?? { companies: 0, found: 0, sent: 0 };
  const priorDays = [...byDay.entries()].filter(([d]) => d !== today).map(([, v]) => v);
  const n = priorDays.length || 1;
  const baseCompanies = Math.round(priorDays.reduce((s, v) => s + v.companies, 0) / n);
  const baseFound = Math.round(priorDays.reduce((s, v) => s + v.found, 0) / n);
  const avgFoundToday = todayStats.companies
    ? Number((todayStats.found / todayStats.companies).toFixed(2))
    : 0;
  const baseAvgFound = priorDays.length
    ? Number(
        (
          priorDays.reduce((s, v) => s + (v.companies ? v.found / v.companies : 0), 0) / n
        ).toFixed(2),
      )
    : 0;

  // With the error guard, a Moltsets outage shows up as far fewer companies marked done
  // today (the affected ones stay in the pool) and/or a collapsed people-per-company yield.
  const lowVolume = baseCompanies > 0 && todayStats.companies < 0.5 * baseCompanies;
  const lowYield =
    todayStats.companies >= 20 && avgFoundToday < Math.max(1.0, 0.5 * baseAvgFound);
  const anomaly = lowVolume || lowYield;

  const status = anomaly ? "⚠️ Cold pipeline anomaly" : "✅ Cold pipeline healthy";
  const report = [
    `${status} — WhoGoes Cold → Plusvibe (${today} IST)`,
    ``,
    `Companies done: ${todayStats.companies} (7-day avg ${baseCompanies})`,
    `People found: ${todayStats.found} (7-day avg ${baseFound})`,
    `Contactable / safe: ${todayStats.sent}`,
    `Yield: ${avgFoundToday} people/company (7-day avg ${baseAvgFound})`,
    anomaly
      ? `\nLikely a vendor (Moltsets) outage. The error guard held back the affected companies so they were NOT burned — they stay in the pool and retry on the next run. Check the Moltsets API and the "Discover 25" node execution.`
      : ``,
  ]
    .filter((line) => line !== "")
    .join("\n");

  return NextResponse.json({
    ok: true,
    today,
    anomaly,
    report,
    today_stats: todayStats,
    baseline: { baseCompanies, baseFound, baseAvgFound },
  });
}

export const GET = handle;
export const POST = handle;
