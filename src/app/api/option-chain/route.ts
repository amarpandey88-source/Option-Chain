// ============================================================================
// Option Chain API — two modes, both real, never fake.
// ----------------------------------------------------------------------------
// - source=broker : fully real (real spot + real broker OI/PCR/chain).
//                    Trade alerts are allowed on this mode.
// - source=nse     : real spot/VIX (Yahoo Finance) but the option-chain
//                    OI/PCR/Max Pain/GEX numbers are estimated, not sourced
//                    from a real chain — clearly labeled as "view only" in
//                    the response so the frontend can disable trade alerts
//                    even if the UI is showing it.
//
// Neither mode ever silently substitutes fabricated data for a failed real
// fetch — a failure returns an error, not fake numbers.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { generateSnapshotBroker, isBrokerConfigured, getConfiguredBroker } from "@/lib/broker-adapter";
import { generateSnapshotYahoo } from "@/lib/yahoo-adapter";
import { applyAdaptiveConfidence } from "@/lib/adaptive-confidence";
import { ensureWatcherStarted } from "@/lib/multi-symbol-watcher";
import { Symbol } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 20;

export async function GET(req: NextRequest) {
  // Lazily starts the background multi-symbol watcher (see
  // multi-symbol-watcher.ts) the first time this route is ever hit — i.e.
  // as soon as the app is actually opened and starts polling, not on every
  // cold module load (which would also fire during `next build`). The
  // function itself no-ops on every call after the first.
  ensureWatcherStarted();

  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get("symbol") || "NIFTY") as Symbol;
  const valid: Symbol[] = ["NIFTY", "BANKNIFTY", "SENSEX"];
  const sym = valid.includes(symbol) ? symbol : "NIFTY";
  const source = searchParams.get("source") === "nse" ? "nse" : "broker";
  const expiry = searchParams.get("expiry") || undefined; // ISO date (YYYY-MM-DD); omitted = default/nearest real expiry

  const noStoreHeaders = { "Cache-Control": "no-store, no-cache, must-revalidate" };

  if (source === "nse") {
    try {
      const s = await generateSnapshotYahoo(sym, expiry);
      return NextResponse.json(
        { ...s, dataSource: "nse-view-only", alertsAllowed: false },
        { headers: noStoreHeaders }
      );
    } catch (err) {
      console.error("[api/option-chain] NSE/Yahoo fetch failed:", err);
      return NextResponse.json(
        {
          error: "DATA_UNAVAILABLE",
          message: err instanceof Error ? err.message : "Failed to fetch live NSE spot data.",
        },
        { status: 503, headers: noStoreHeaders }
      );
    }
  }

  // source === "broker"
  if (!isBrokerConfigured()) {
    return NextResponse.json(
      {
        error: "BROKER_NOT_CONFIGURED",
        message: "No broker is configured. Add real API keys via the API Keys button in the header to get real option-chain data and enable trade alerts.",
      },
      { status: 400, headers: noStoreHeaders }
    );
  }

  try {
    const raw = await generateSnapshotBroker(sym, expiry);
    const s = await applyAdaptiveConfidence(raw);
    return NextResponse.json(
      { ...s, dataSource: `broker-${getConfiguredBroker()}`, alertsAllowed: true },
      { headers: noStoreHeaders }
    );
  } catch (err) {
    console.error("[api/option-chain] real data fetch failed:", err);
    return NextResponse.json(
      {
        error: "DATA_UNAVAILABLE",
        message: err instanceof Error ? err.message : "Failed to fetch real market data from the broker.",
      },
      { status: 503, headers: noStoreHeaders }
    );
  }
}
