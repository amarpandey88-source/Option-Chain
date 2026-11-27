import type { OptionChainSnapshot } from "./types";

// ============================================================================
// Trade reference — pure logic (no DB, safe to import from the browser too)
// ----------------------------------------------------------------------------
// Every fired trade stores the market context it was opened in (EntryContext,
// kept in the TradeContext table, joined to the journal row by alertId). Once
// enough closed trades exist, this module turns that history into a small,
// bounded confidence nudge for NEW signals: "trades opened in a context like
// this one have been winning more/less than your average".
//
// Deliberately conservative — a handful of trades is noise:
//  - nothing happens until REF_MIN_TOTAL closed trades carry context data
//  - a bucket needs REF_MIN_BUCKET trades before it may move anything
//  - bucket win rates are shrunk toward the overall win rate (n / (n + K))
//  - the nudge is small, capped, and easier to trim (-5) than to boost (+3)
//  - it only ADJUSTS an already-reasoned confidence; it never creates a signal
// ============================================================================

export const REF_MIN_TOTAL = 40;
export const REF_MIN_BUCKET = 20;
const SHRINK_K = 10;
const EDGE_THRESHOLD = 0.10; // shrunk bucket win rate must differ from the base by this much
const BOOST = 3;
const TRIM = -5;
const DELTA_MIN = -10;
const DELTA_MAX = 5;

export interface EntryContext {
  v: 1;
  istMinute: number;
  vix: number | null;
  pcr: number | null;
  gex: number | null;
  atmIv: number | null;
  regime: string;
  smartQuality: string;
  smartScore: number;
  smartConfidence: number;
  confidence: number;
  stability: number;
  rr: number | null; // reward:risk to Target 1, from the recommendation's own levels
}

const finite = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) ? n : null);

export function istMinuteOfDay(d: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const h = Number(parts.find(p => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find(p => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

export function buildEntryContext(s: OptionChainSnapshot): EntryContext {
  const rec = s.recommendation;
  const risk = rec.entry - rec.stopLoss;
  return {
    v: 1,
    istMinute: istMinuteOfDay(),
    vix: finite(s.metrics.indiaVix),
    pcr: finite(s.metrics.pcr),
    gex: finite(s.metrics.gex),
    atmIv: finite(s.greeks?.iv),
    regime: s.metrics.regime,
    smartQuality: s.smartSignal?.quality ?? "WAIT",
    smartScore: finite(s.smartSignal?.score) ?? 0,
    smartConfidence: finite(s.smartSignal?.confidence) ?? 0,
    confidence: finite(s.overallSignal.confidence) ?? 0,
    stability: finite(s.signalStability?.consecutiveCount) ?? 0,
    rr: risk > 0 ? Number(((rec.target1 - rec.entry) / risk).toFixed(2)) : null,
  };
}

// ---- Buckets ---------------------------------------------------------------

export type DimensionName = "time" | "vix" | "quality" | "regime" | "action";
// Only these three ever move confidence. regime x action is already handled by
// adaptive-confidence's own situational stage, so they are shown but not used.
export const ACTIVE_DIMENSIONS: DimensionName[] = ["time", "vix", "quality"];

export function timeBand(minute: number): string {
  if (minute < 10 * 60) return "09:15-10:00";
  if (minute < 12 * 60) return "10:00-12:00";
  if (minute < 14 * 60) return "12:00-14:00";
  return "14:00-15:15";
}
export function vixBand(v: number | null): string | null {
  if (v === null) return null;
  return v < 13 ? "VIX below 13" : v <= 18 ? "VIX 13-18" : "VIX above 18";
}
export function qualityBand(q: string): string | null {
  return q === "A" || q === "B" || q === "C" ? `Quality ${q}` : null;
}

export function dimensionsOf(ctx: EntryContext, action?: string): Partial<Record<DimensionName, string>> {
  const out: Partial<Record<DimensionName, string>> = {
    time: timeBand(ctx.istMinute),
    regime: ctx.regime,
  };
  const v = vixBand(ctx.vix); if (v) out.vix = v;
  const q = qualityBand(ctx.smartQuality); if (q) out.quality = q;
  if (action) out.action = action;
  return out;
}

export interface ReferenceRow { win: boolean; pnl: number; action: string; ctx: EntryContext }

export interface ReferenceBucket {
  label: string;
  n: number;
  wins: number;
  winRate: number;        // raw %, 0-100
  shrunkWinRate: number;  // % after shrinking toward the base win rate
  avgPnl: number;         // average gross P&L per trade (₹, per the journal's lot size)
  lowSample: boolean;
}
export interface ReferenceStats {
  total: number;
  baseWinRate: number | null; // % over all rows with context
  active: boolean;
  minTotal: number;
  minBucket: number;
  dims: Record<DimensionName, ReferenceBucket[]>;
}

const DIMS: DimensionName[] = ["time", "vix", "quality", "regime", "action"];

export function computeReference(rows: ReferenceRow[]): ReferenceStats {
  const total = rows.length;
  const base = total ? rows.filter(r => r.win).length / total : 0;
  const raw: Record<string, Record<string, { n: number; wins: number; pnl: number }>> = {};
  for (const d of DIMS) raw[d] = {};
  for (const r of rows) {
    const dims = dimensionsOf(r.ctx, r.action);
    for (const d of DIMS) {
      const label = dims[d];
      if (!label) continue;
      const b = (raw[d][label] ||= { n: 0, wins: 0, pnl: 0 });
      b.n++; if (r.win) b.wins++; b.pnl += r.pnl;
    }
  }
  const dimsOut = {} as Record<DimensionName, ReferenceBucket[]>;
  for (const d of DIMS) {
    dimsOut[d] = Object.entries(raw[d]).map(([label, b]) => ({
      label, n: b.n, wins: b.wins,
      winRate: Number(((b.wins / b.n) * 100).toFixed(1)),
      shrunkWinRate: Number((((b.wins + SHRINK_K * base) / (b.n + SHRINK_K)) * 100).toFixed(1)),
      avgPnl: Number((b.pnl / b.n).toFixed(0)),
      lowSample: b.n < REF_MIN_BUCKET,
    })).sort((a, b) => b.n - a.n);
  }
  return {
    total,
    baseWinRate: total ? Number((base * 100).toFixed(1)) : null,
    active: total >= REF_MIN_TOTAL,
    minTotal: REF_MIN_TOTAL,
    minBucket: REF_MIN_BUCKET,
    dims: dimsOut,
  };
}

export function referenceAdjustment(ctx: EntryContext, ref: ReferenceStats): { delta: number; notes: string[] } {
  if (!ref.active || ref.baseWinRate === null) return { delta: 0, notes: [] };
  const dims = dimensionsOf(ctx);
  let delta = 0;
  const notes: string[] = [];
  for (const d of ACTIVE_DIMENSIONS) {
    const label = dims[d];
    if (!label) continue;
    const b = ref.dims[d].find(x => x.label === label);
    if (!b || b.n < REF_MIN_BUCKET) continue;
    const edge = (b.shrunkWinRate - ref.baseWinRate) / 100;
    let step = 0;
    if (edge >= EDGE_THRESHOLD) step = BOOST;
    else if (edge <= -EDGE_THRESHOLD) step = TRIM;
    if (step === 0) continue;
    delta += step;
    notes.push(`Reference: ${label} trades won ${b.winRate}% of ${b.n} past trades vs ${ref.baseWinRate}% overall — confidence ${step > 0 ? "+" : ""}${step}`);
  }
  return { delta: Math.max(DELTA_MIN, Math.min(DELTA_MAX, delta)), notes };
}
