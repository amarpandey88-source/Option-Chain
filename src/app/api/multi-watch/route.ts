import { NextRequest, NextResponse } from "next/server";
import { getWatchStatus, setActivelyViewedSymbol } from "@/lib/multi-symbol-watcher";
import { Symbol } from "@/lib/types";

export const dynamic = "force-dynamic";

const VALID_SYMBOLS: Symbol[] = ["NIFTY", "BANKNIFTY", "SENSEX"];

// GET — current status of all 3 symbols (last signal/confidence, any open
// background trade, whether it's currently hands-off to the frontend).
export async function GET() {
  return NextResponse.json(getWatchStatus());
}

// POST — heartbeat from the frontend: "I'm currently viewing this symbol,
// leave it to my own live-tick monitoring." Sent on symbol change and
// periodically while a symbol stays selected (see page.tsx).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const symbol = body.symbol as Symbol | null;
    if (symbol !== null && !VALID_SYMBOLS.includes(symbol)) {
      return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
    }
    setActivelyViewedSymbol(symbol);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed" }, { status: 500 });
  }
}
