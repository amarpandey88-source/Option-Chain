import { db, ensureSchema } from "./db";
import type { Symbol } from "./types";

const HISTORY_METRICS = ["spot", "pcr", "vix", "rsi5", "rsi15", "rsi30"] as const;
const MAX_HISTORY_POINTS = 1500;
const RETENTION_DAYS = 30;

type HistoryMetric = (typeof HISTORY_METRICS)[number];
type MarketHistory = Record<HistoryMetric, { t: string; v: number }[]>;

export async function getMarketHistory(symbol: Symbol, dataSource: "nse" | "broker"): Promise<MarketHistory> {
  await ensureSchema();

  const entries = await Promise.all(HISTORY_METRICS.map(async (metric) => {
    const rows = await db.$queryRaw<{ t: string; v: number }[]>`
      SELECT "capturedAt" AS "t", "value" AS "v"
      FROM "MarketHistory"
      WHERE "symbol" = ${symbol} AND "dataSource" = ${dataSource} AND "metric" = ${metric}
      ORDER BY "capturedAt" DESC
      LIMIT ${MAX_HISTORY_POINTS}
    `;
    return [metric, rows.reverse()] as const;
  }));

  return Object.fromEntries(entries) as MarketHistory;
}

export async function persistMarketHistory(
  symbol: Symbol,
  dataSource: "nse" | "broker",
  values: Record<HistoryMetric, number>,
): Promise<MarketHistory> {
  await ensureSchema();

  const captured = new Date();
  captured.setUTCSeconds(0, 0);
  const capturedAt = captured.toISOString();

  for (const metric of HISTORY_METRICS) {
    await db.$executeRaw`
      INSERT OR IGNORE INTO "MarketHistory" ("symbol", "dataSource", "metric", "capturedAt", "value")
      VALUES (${symbol}, ${dataSource}, ${metric}, ${capturedAt}, ${values[metric]})
    `;
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.$executeRaw`DELETE FROM "MarketHistory" WHERE "capturedAt" < ${cutoff}`;

  return getMarketHistory(symbol, dataSource);
}