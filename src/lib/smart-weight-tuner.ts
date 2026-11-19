import { MIN_SAMPLE_SIZE } from "./journal-stats-constants";
import type { SmartFactorKey } from "./smart-signal-engine";

// ============================================================================
// Smart-engine weight tuning — learns from the trade journal's real outcomes
// ----------------------------------------------------------------------------
// Every trade logged from now on stores the Smart engine's per-factor scores
// at entry (TradeJournal.smartFactors, JSON {FACTOR_KEY: -100..+100}).
//
// For each factor we look at closed trades where that factor SUPPORTED the
// trade direction (score pointing the same way, |score| >= SUPPORT_MIN) and
// compare their win rate with the overall win rate of all tuned trades:
//   - factor-supported trades win more than average -> weight goes up
//   - they win less than average                    -> weight goes down
//
// Deliberately conservative (small samples are noise):
//   - a factor needs MIN_SAMPLE_SIZE supporting trades AND the journal needs
//     MIN_TOTAL_TRADES closed trades with factor data, otherwise multiplier=1
//   - the raw edge is shrunk toward 0 by n/(n+SHRINK_K)
//   - multipliers are clamped to [0.6, 1.4] so no factor can be switched off
//     or take over the engine
//   - any DB error -> no tuning (all 1.0)
// Trades logged before this feature have no factor data and are ignored.
// ============================================================================

export type WeightMultipliers = Partial<Record<SmartFactorKey, number>>;
export interface FactorTuningStat {
  key: SmartFactorKey;
  multiplier: number;
  supportedTrades: number;
  supportedWinRate: number | null;
}
export interface WeightTuning {
  multipliers: WeightMultipliers;
  stats: FactorTuningStat[];
  sampleSize: number; // closed trades with factor data
  active: boolean;
}

const SUPPORT_MIN = 20;     // |factor score| needed to count as "supporting"
const MIN_TOTAL_TRADES = 15;
const SHRINK_K = 10;
const SENSITIVITY = 1.2;    // edge of +0.25 win-rate -> ~+30% raw weight change
const MULT_MIN = 0.6;
const MULT_MAX = 1.4;
const CACHE_MS = 60_000;

const KEYS: SmartFactorKey[] = [
  "TIMEFRAME_CONSENSUS", "MOMENTUM", "VWAP", "PCR", "OI_FLOW",
  "GEX", "SMART_FLOW", "REGIME", "CROSS_MARKET", "STABILITY",
];

let cache: { at: number; value: WeightTuning } | null = null;

export function tuneFromTrades(
  trades: { action: string; totalPnl: number | null; smartFactors: string | null }[],
): WeightTuning {
  const rows: { dir: 1 | -1; win: boolean; f: Record<string, number> }[] = [];
  for (const t of trades) {
    if (!t.smartFactors || t.totalPnl === null) continue;
    const dir = t.action === "BUY CE" ? 1 : t.action === "BUY PE" ? -1 : 0;
    if (dir === 0) continue;
    try {
      const f = JSON.parse(t.smartFactors);
      if (f && typeof f === "object") rows.push({ dir, win: t.totalPnl > 0, f });
    } catch { /* ignore malformed row */ }
  }
  const baseWin = rows.length ? rows.filter(r => r.win).length / rows.length : 0;
  const active = rows.length >= MIN_TOTAL_TRADES;
  const multipliers: WeightMultipliers = {};
  const stats: FactorTuningStat[] = [];

  for (const key of KEYS) {
    const supp = rows.filter(r => typeof r.f[key] === "number" && r.f[key] * r.dir >= SUPPORT_MIN);
    const n = supp.length;
    const wr = n ? supp.filter(r => r.win).length / n : null;
    let mult = 1;
    if (active && n >= MIN_SAMPLE_SIZE && wr !== null) {
      const edge = (wr - baseWin) * (n / (n + SHRINK_K));
      mult = Math.min(MULT_MAX, Math.max(MULT_MIN, 1 + edge * SENSITIVITY * 2));
    }
    mult = Number(mult.toFixed(2));
    if (mult !== 1) multipliers[key] = mult;
    stats.push({ key, multiplier: mult, supportedTrades: n, supportedWinRate: wr === null ? null : Number(wr.toFixed(2)) });
  }
  return { multipliers, stats, sampleSize: rows.length, active };
}

export async function getSmartWeightTuning(): Promise<WeightTuning> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  let value: WeightTuning = { multipliers: {}, stats: [], sampleSize: 0, active: false };
  try {
    const { db, ensureSchema } = await import("./db");
    await ensureSchema();
    const trades = await db.tradeJournal.findMany({
      where: { status: { not: "OPEN" }, totalPnl: { not: null }, smartFactors: { not: null } },
      select: { action: true, totalPnl: true, smartFactors: true },
      orderBy: { closedAt: "desc" },
      take: 300,
    });
    value = tuneFromTrades(trades);
  } catch { /* fail silent: no tuning */ }
  cache = { at: Date.now(), value };
  return value;
}
