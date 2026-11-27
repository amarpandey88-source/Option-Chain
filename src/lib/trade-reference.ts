import { db, ensureSchema } from "./db";
import { computeReference, type EntryContext, type ReferenceRow, type ReferenceStats } from "./trade-reference-core";

// DB side of the trade reference (see trade-reference-core.ts for the logic).
// Uses raw SQL on its own TradeContext table on purpose: the journal's typed
// Prisma create is the one write that must never fail, so nothing here touches
// its schema or its generated client — a problem in this file can only ever
// cost reference data, never a journal entry.

export async function recordTradeContext(alertId: string, ctx: EntryContext): Promise<void> {
  try {
    await ensureSchema();
    await db.$executeRaw`
      INSERT OR REPLACE INTO "TradeContext" ("alertId", "context", "recordedAt")
      VALUES (${alertId}, ${JSON.stringify(ctx)}, ${new Date().toISOString()})
    `;
  } catch (err) {
    console.error("[trade-reference] recordTradeContext failed:", err);
  }
}

interface JoinedRow { action: string; totalPnl: number; context: string }

const CACHE_MS = 60_000;
let cache: { at: number; value: ReferenceStats } | null = null;

export async function getReference(force = false): Promise<ReferenceStats> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  let value = computeReference([]);
  try {
    await ensureSchema();
    // Real broker-mode trades only (Yahoo mode has simulated OI), closed, newest first.
    const rows = await db.$queryRaw<JoinedRow[]>`
      SELECT j."action" AS action, j."totalPnl" AS totalPnl, c."context" AS context
      FROM "TradeJournal" j
      JOIN "TradeContext" c ON c."alertId" = j."alertId"
      WHERE j."status" != 'OPEN' AND j."totalPnl" IS NOT NULL AND j."dataSource" LIKE 'broker%'
      ORDER BY j."closedAt" DESC
      LIMIT 500
    `;
    const parsed: ReferenceRow[] = [];
    for (const r of rows) {
      try {
        const ctx = JSON.parse(r.context) as EntryContext;
        if (ctx && ctx.v === 1 && typeof ctx.istMinute === "number") {
          parsed.push({ win: r.totalPnl > 0, pnl: r.totalPnl, action: r.action, ctx });
        }
      } catch { /* skip malformed row */ }
    }
    value = computeReference(parsed);
  } catch (err) {
    console.error("[trade-reference] getReference failed, no reference applied:", err);
  }
  cache = { at: Date.now(), value };
  return value;
}
