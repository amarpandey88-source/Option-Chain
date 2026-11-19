import { NextRequest, NextResponse } from "next/server";

// db/signal-log imported dynamically inside the try block, same convention as
// the trade-journal routes: a static top-level import would turn any DB/client
// problem into a raw non-JSON crash page instead of a real JSON error.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { getSignalStats, resolveSignalOutcomes } = await import("@/lib/signal-log");
    const { searchParams } = new URL(req.url);

    const days = Math.min(90, Math.max(1, Number(searchParams.get("days")) || 30));
    const h = Number(searchParams.get("horizon"));
    const horizon = (h === 15 || h === 60 ? h : 30) as 15 | 30 | 60;
    const symbolParam = searchParams.get("symbol");
    const symbol = symbolParam && ["NIFTY", "BANKNIFTY", "SENSEX"].includes(symbolParam) ? symbolParam : undefined;

    await resolveSignalOutcomes(); // make sure anything that has aged enough is filled in
    const stats = await getSignalStats({ days, horizon, symbol });
    return NextResponse.json(stats);
  } catch (err) {
    console.error("[api/signal-log/stats] failed:", err);
    return NextResponse.json(
      { error: "SIGNAL_LOG_FAILED", message: err instanceof Error ? err.message : "Failed to compute signal stats." },
      { status: 500 },
    );
  }
}
