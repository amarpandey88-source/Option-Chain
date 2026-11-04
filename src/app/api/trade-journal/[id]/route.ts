import { NextRequest, NextResponse } from "next/server";

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
    if (body.exitPremium !== undefined) u.exitPremium = parseFloat(body.exitPremium);
    if (body.pnlPerLot !== undefined) u.pnlPerLot = parseFloat(body.pnlPerLot);
    if (body.totalPnl !== undefined) u.totalPnl = parseFloat(body.totalPnl);
    const tradingCharges = body.tradingCharges !== undefined ? Math.max(0, parseFloat(body.tradingCharges)) : (existing.tradingCharges ?? 0);
    if (body.tradingCharges !== undefined) u.tradingCharges = tradingCharges;
    if (body.totalPnl !== undefined || body.tradingCharges !== undefined) {
      const grossProfit = body.totalPnl !== undefined ? parseFloat(body.totalPnl) : (existing.totalPnl ?? 0);
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
