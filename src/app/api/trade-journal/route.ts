import { NextRequest, NextResponse } from "next/server";

// db/ensureSchema are imported dynamically INSIDE each try block below, not
// statically at the top of the file. If module resolution or client
// construction ever fails (missing/stale generated Prisma client, wrong
// binary, etc.), a static top-level import throws before any try/catch in
// this file even exists — Next.js then serves its own raw, non-JSON crash
// page. That's exactly what produces a blank "HTTP 500" with no real error
// message: the client-side fetch tries to res.json() a non-JSON body, that
// parse silently fails, and the toast falls back to a useless generic
// "HTTP 500". A dynamic import here happens *inside* the try block, so any
// failure — at any stage — is guaranteed to come back as a real JSON error
// with an actual message instead of a mystery crash.

export async function GET(req: NextRequest) {
  try {
    const { db, ensureSchema } = await import("@/lib/db");
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const symbol = searchParams.get("symbol");
    // New filters — additive, kept separate from the existing `status`
    // param (OPEN/CLOSED) so page.tsx's and multi-symbol-watcher.ts's
    // existing `?status=OPEN` calls keep behaving exactly as before.
    const result = searchParams.get("result"); // "win" | "loss" | "open" | null (= all)
    const period = searchParams.get("period"); // "today" | "7d" | "30d" | "month" | null (= all time)
    const action = searchParams.get("action"); // "BUY CE" | "BUY PE" | null (= all)
    const source = searchParams.get("source"); // "live" | "background" | null (= all) — background trades are the ones the multi-symbol watcher auto-fired (see multi-symbol-watcher.ts's alertId prefix)

    const where: any = {};
    if (status === "OPEN") where.status = "OPEN";
    else if (status === "CLOSED") where.status = { in: ["TARGET1_HIT", "TARGET2_HIT", "TARGET3_HIT", "SL_HIT", "MANUAL_CLOSE", "EOD_SQUAREOFF"] };
    if (symbol && symbol !== "ALL") where.symbol = symbol;
    if (action === "BUY CE" || action === "BUY PE") where.action = action;
    if (source === "background") where.alertId = { startsWith: "bg-" };
    else if (source === "live") where.alertId = { not: { startsWith: "bg-" } };

    if (result === "open") {
      where.status = "OPEN";
    } else if (result === "win") {
      where.status = { not: "OPEN" };
      where.totalPnl = { gt: 0 };
    } else if (result === "loss") {
      where.status = { not: "OPEN" };
      where.totalPnl = { lte: 0 };
    }

    if (period && period !== "all") {
      // "Today"/period boundaries reasoned in IST, matching how the rest
      // of the app already reasons about the trading day (EOD square-off,
      // multi-symbol-watcher's daily trade cap, etc.) rather than the
      // server's own local timezone.
      const nowIst = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      let from: Date;
      if (period === "today") {
        from = new Date(nowIst); from.setHours(0, 0, 0, 0);
      } else if (period === "7d") {
        from = new Date(nowIst.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (period === "30d") {
        from = new Date(nowIst.getTime() - 30 * 24 * 60 * 60 * 1000);
      } else if (period === "month") {
        from = new Date(nowIst.getFullYear(), nowIst.getMonth(), 1);
      } else {
        from = new Date(0);
      }
      // openedAt is stored as a real UTC instant, so converting the IST
      // boundary back with the same offset keeps the comparison correct
      // regardless of the server's own local timezone.
      const istOffsetMs = nowIst.getTime() - Date.now();
      where.openedAt = { gte: new Date(from.getTime() - istOffsetMs) };
    }

    const trades = await db.tradeJournal.findMany({ where, orderBy: { openedAt: "desc" }, take: Math.min(limit, 200) });

    // Stats reflect the SAME filters as the trade list above (minus the
    // take/limit cap) — so the win-rate/P&L summary always matches what's
    // actually shown in the filtered table, not some separate unfiltered
    // view of everything.
    const allTrades = await db.tradeJournal.findMany({ where, orderBy: { openedAt: "desc" }, take: 2000 });
    const closed = allTrades.filter(t => t.status !== "OPEN" && t.totalPnl !== null);
    const wins = closed.filter(t => (t.totalPnl ?? 0) > 0);
    const losses = closed.filter(t => (t.totalPnl ?? 0) <= 0);
    const totalPnl = closed.reduce((s, t) => s + (t.totalPnl ?? 0), 0);
    const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + (t.totalPnl ?? 0), 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + (t.totalPnl ?? 0), 0) / losses.length : 0;
    return NextResponse.json({ trades, stats: { total: allTrades.length, open: allTrades.filter(t => t.status === "OPEN").length, closed: closed.length, wins: wins.length, losses: losses.length, winRate: Number(winRate.toFixed(1)), totalPnl: Number(totalPnl.toFixed(2)), avgWin: Number(avgWin.toFixed(2)), avgLoss: Number(avgLoss.toFixed(2)) } });
  } catch (err: any) {
    console.error("[trade-journal GET] error:", err);
    return NextResponse.json({ error: err?.message || String(err) || "Failed to load trade journal" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { db, ensureSchema } = await import("@/lib/db");
    await ensureSchema();
    const body = await req.json();
    const req_ = ["alertId","symbol","action","optionType","strike","entryPremium","stopLoss","target1","target2","target3","entrySpot","confidence","sentiment","rationale"];
    for (const f of req_) if (body[f] === undefined || body[f] === null) return NextResponse.json({ error: `Missing field: ${f}` }, { status: 400 });
    const existing = await db.tradeJournal.findUnique({ where: { alertId: body.alertId } });
    if (existing) return NextResponse.json({ trade: existing, duplicate: true });
    const trade = await db.tradeJournal.create({ data: { alertId: body.alertId, symbol: body.symbol, action: body.action, optionType: body.optionType, strike: parseInt(body.strike, 10), entryPremium: parseFloat(body.entryPremium), stopLoss: parseFloat(body.stopLoss), target1: parseFloat(body.target1), target2: parseFloat(body.target2), target3: parseFloat(body.target3), entrySpot: parseFloat(body.entrySpot), confidence: parseInt(body.confidence, 10), sentiment: body.sentiment, dataSource: body.dataSource || "unknown", regime: body.regime || null, rationale: body.rationale, status: "OPEN" } });
    return NextResponse.json({ trade, created: true });
  } catch (err: any) { console.error("[trade-journal POST] error:", err); return NextResponse.json({ error: err?.message || String(err) || "Failed" }, { status: 500 }); }
}

export async function DELETE(req: NextRequest) {
  try {
    const { db, ensureSchema } = await import("@/lib/db");
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    if (searchParams.get("confirm") !== "DELETE") return NextResponse.json({ error: "Confirmation required" }, { status: 400 });
    const result = await db.tradeJournal.deleteMany({});
    return NextResponse.json({ deleted: result.count });
  } catch (err: any) {
    console.error("[trade-journal DELETE] error:", err);
    return NextResponse.json({ error: err?.message || String(err) || "Failed to clear trade journal" }, { status: 500 });
  }
}
