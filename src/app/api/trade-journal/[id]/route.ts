import { NextRequest, NextResponse } from "next/server";
import { estimateFyersOptionsCharges } from "@/lib/fyers-options-charges";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db, ensureSchema } = await import("@/lib/db");
    await ensureSchema();
    const { id } = await params; const body = await req.json();
    const existing = await db.tradeJournal.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Trade not found" }, { status: 404 });
    const u: any = {};
    if (body.status) u.status = body.status;
    if (body.exitSpot !== undefined) u.exitSpot = parseFloat(body.exitSpot);
    const exitPremium = body.exitPremium !== undefined ? parseFloat(body.exitPremium) : existing.exitPremium;
    if (body.exitPremium !== undefined) u.exitPremium = exitPremium;
    if (body.pnlPerLot !== undefined) u.pnlPerLot = parseFloat(body.pnlPerLot);
    const totalPnl = body.totalPnl !== undefined ? parseFloat(body.totalPnl) : existing.totalPnl;
    if (body.totalPnl !== undefined) u.totalPnl = totalPnl;
    const isFyersTrade = existing.dataSource.toLowerCase().includes("fyers");
    const estimatedCharges = isFyersTrade && exitPremium !== null && exitPremium > 0
      ? estimateFyersOptionsCharges(
        existing.entryPremium,
        exitPremium,
        existing.symbol === "BANKNIFTY" ? 30 : existing.symbol === "SENSEX" ? 20 : 65,
      )
      : 0;
    const shouldEstimate = body.tradingCharges === undefined
      ? existing.chargesEstimated && existing.tradingCharges === 0 && estimatedCharges > 0
      : body.chargesEstimated === true;
    const tradingCharges = body.tradingCharges !== undefined
      ? Math.max(0, parseFloat(body.tradingCharges))
      : shouldEstimate ? estimatedCharges : (existing.tradingCharges ?? 0);
    if (body.tradingCharges !== undefined || shouldEstimate) {
      u.tradingCharges = tradingCharges;
      u.chargesEstimated = shouldEstimate;
    }
    if (totalPnl !== null && (body.totalPnl !== undefined || body.tradingCharges !== undefined || shouldEstimate)) {
      const grossProfit = totalPnl;
      u.netPnl = grossProfit - tradingCharges;
    }
    if (body.pnlPercent !== undefined) u.pnlPercent = parseFloat(body.pnlPercent);
    if (body.durationSec !== undefined) u.durationSec = parseInt(body.durationSec, 10);
    if (body.exitReason) u.exitReason = body.exitReason;
    if (body.status && body.status !== "OPEN") u.closedAt = new Date();
    const trade = await db.tradeJournal.update({ where: { id }, data: u });
    return NextResponse.json({ trade });
  } catch (err: any) { console.error("[trade-journal PATCH] error:", err); return NextResponse.json({ error: err?.message || String(err) || "Failed" }, { status: 500 }); }
}
