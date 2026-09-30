import { NextRequest, NextResponse } from "next/server";
import { getMarketHistory } from "@/lib/market-history";
import type { Symbol } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const EMPTY_HISTORY = { spot: [], pcr: [], vix: [] };

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol") as Symbol | null;
  const source = searchParams.get("source");

  if (!symbol || !["NIFTY", "BANKNIFTY", "SENSEX"].includes(symbol) || (source !== "nse" && source !== "broker")) {
    return NextResponse.json({ error: "Invalid symbol or data source." }, { status: 400 });
  }

  try {
    const history = await getMarketHistory(symbol, source);
    return NextResponse.json({ history }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[api/market-history] failed to load market history:", err);
    return NextResponse.json({ history: EMPTY_HISTORY, available: false }, { headers: { "Cache-Control": "no-store" } });
  }
}