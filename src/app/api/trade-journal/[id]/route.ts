import { NextRequest, NextResponse } from "next/server";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db, ensureSchema } = await import("@/lib/db");
    await ensureSchema();
    const { id } = await params; const body = await req.json();
    const u: any = {};
    if (body.status) u.status = body.status;
    if (body.exitSpot !== undefined) u.exitSpot = parseFloat(body.exitSpot);
    if (body.exitPremium !== undefined) u.exitPremium = parseFloat(body.exitPremium);
    if (body.pnlPerLot !== undefined) u.pnlPerLot = parseFloat(body.pnlPerLot);
    if (body.totalPnl !== undefined) u.totalPnl = parseFloat(body.totalPnl);
    if (body.pnlPercent !== undefined) u.pnlPercent = parseFloat(body.pnlPercent);
    if (body.durationSec !== undefined) u.durationSec = parseInt(body.durationSec, 10);
    if (body.exitReason) u.exitReason = body.exitReason;
    if (body.status && body.status !== "OPEN") u.closedAt = new Date();
    const trade = await db.tradeJournal.update({ where: { id }, data: u });
    return NextResponse.json({ trade });
  } catch (err: any) { console.error("[trade-journal PATCH] error:", err); return NextResponse.json({ error: err?.message || String(err) || "Failed" }, { status: 500 }); }
}
