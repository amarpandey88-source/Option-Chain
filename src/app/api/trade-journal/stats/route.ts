import { NextRequest, NextResponse } from "next/server";
import { MIN_SAMPLE_SIZE } from "@/lib/journal-stats-constants";
import { computeCalibration } from "@/lib/confidence-calibration";

// db/ensureSchema imported dynamically inside the try block for the same
// reason as the other trade-journal routes — see route.ts's comment on
// this. A static top-level import would turn any DB/client problem into a
// raw non-JSON crash page instead of a real JSON error.

export const dynamic = "force-dynamic";

interface Bucket { label: string; total: number; wins: number; winRate: number; totalPnl: number }

function toBucket(label: string, trades: { totalPnl: number | null }[]): Bucket {
  const wins = trades.filter(t => (t.totalPnl ?? 0) > 0).length;
  const totalPnl = trades.reduce((s, t) => s + (t.totalPnl ?? 0), 0);
  return { label, total: trades.length, wins, winRate: trades.length ? Number(((wins / trades.length) * 100).toFixed(1)) : 0, totalPnl: Number(totalPnl.toFixed(2)) };
}

export async function GET(req: NextRequest) {
  try {
    const { db, ensureSchema } = await import("@/lib/db");
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get("symbol");
    const where: any = { status: { not: "OPEN" }, totalPnl: { not: null } };
    if (symbol && symbol !== "ALL") where.symbol = symbol;

    // Cap at the most recent 1000 closed trades — plenty for meaningful
    // stats, and keeps this fast without needing a separate aggregate
    // query for every breakdown.
    const closed = await db.tradeJournal.findMany({ where, orderBy: { openedAt: "desc" }, take: 1000 });

    if (closed.length === 0) {
      return NextResponse.json({ hasData: false, minSampleSize: MIN_SAMPLE_SIZE });
    }

    const wins = closed.filter(t => (t.totalPnl ?? 0) > 0);
    const totalPnl = closed.reduce((s, t) => s + (t.totalPnl ?? 0), 0);
    const avgWin = wins.length ? wins.reduce((s, t) => s + (t.totalPnl ?? 0), 0) / wins.length : 0;
    const losses = closed.filter(t => (t.totalPnl ?? 0) <= 0);
    const avgLoss = losses.length ? losses.reduce((s, t) => s + (t.totalPnl ?? 0), 0) / losses.length : 0;
    const avgDurationSec = closed.filter(t => t.durationSec != null).length
      ? closed.reduce((s, t) => s + (t.durationSec ?? 0), 0) / closed.filter(t => t.durationSec != null).length
      : null;

    // By regime — only trades logged after the "regime" field was added
    // have this; older rows are simply excluded from this breakdown
    // (they still count in the overall stats above).
    const regimes = ["TRENDING UP", "TRENDING DOWN", "RANGEBOUND", "VOLATILE"];
    const byRegime = regimes
      .map(r => toBucket(r, closed.filter(t => t.regime === r)))
      .filter(b => b.total > 0);

    // By confidence bucket
    const confBands: [number, number, string][] = [[50, 60, "50-59%"], [60, 70, "60-69%"], [70, 80, "70-79%"], [80, 90, "80-89%"], [90, 101, "90-100%"]];
    const byConfidence = confBands
      .map(([lo, hi, label]) => toBucket(label, closed.filter(t => t.confidence >= lo && t.confidence < hi)))
      .filter(b => b.total > 0);

    // By action (BUY CE vs BUY PE)
    const byAction = ["BUY CE", "BUY PE"]
      .map(a => toBucket(a, closed.filter(t => t.action === a)))
      .filter(b => b.total > 0);

    // By hour of day (IST) — helps spot "this app's signals are worse in
    // the first/last hour of the session" type patterns. Only hours with
    // at least MIN_SAMPLE_SIZE trades are surfaced as best/worst, to avoid
    // a single lucky/unlucky trade looking like a strong pattern.
    const hourBuckets = new Map<number, { totalPnl: number | null }[]>();
    for (const t of closed) {
      const hourIst = new Date(new Date(t.openedAt).getTime() + 5.5 * 60 * 60 * 1000).getUTCHours();
      if (!hourBuckets.has(hourIst)) hourBuckets.set(hourIst, []);
      hourBuckets.get(hourIst)!.push(t);
    }
    const byHour = Array.from(hourBuckets.entries())
      .map(([hour, trades]) => ({ hour, ...toBucket(`${hour}:00-${hour + 1}:00`, trades) }))
      .filter(b => b.total >= MIN_SAMPLE_SIZE)
      .sort((a, b) => b.winRate - a.winRate);

    // Confidence calibration — is stated confidence honest? Reuses the
    // same computation the live adaptive-confidence correction uses (see
    // src/lib/confidence-calibration.ts), so what's shown here is exactly
    // what's actually influencing live signals, not a separate approximation.
    const calibration = await computeCalibration(symbol ?? undefined);

    return NextResponse.json({
      hasData: true,
      minSampleSize: MIN_SAMPLE_SIZE,
      overall: {
        total: closed.length, wins: wins.length, losses: losses.length,
        winRate: Number(((wins.length / closed.length) * 100).toFixed(1)),
        totalPnl: Number(totalPnl.toFixed(2)), avgWin: Number(avgWin.toFixed(2)), avgLoss: Number(avgLoss.toFixed(2)),
        avgDurationSec: avgDurationSec != null ? Math.round(avgDurationSec) : null,
      },
      byRegime, byConfidence, byAction, calibration,
      bestHours: byHour.slice(0, 3),
      worstHours: byHour.slice(-3).reverse(),
    });
  } catch (err: any) {
    console.error("[trade-journal/stats GET] error:", err);
    return NextResponse.json({ error: err?.message || String(err) || "Failed to compute performance stats" }, { status: 500 });
  }
}
