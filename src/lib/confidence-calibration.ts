import { MIN_SAMPLE_SIZE } from "./journal-stats-constants";

// ============================================================================
// Confidence calibration
// ----------------------------------------------------------------------------
// "80% confidence" should mean roughly 80% of trades stated at that
// confidence actually win. This checks whether that's true using the trade
// journal's own real outcomes, and — where there's enough data to trust the
// number — nudges live confidence toward what's actually been happening
// instead of just what the scoring formula originally guessed.
//
// This is a SEPARATE correction from the (action, regime) win-rate nudge in
// adaptive-confidence.ts, and runs BEFORE it: calibration corrects "is an
// 80% call actually an 80% call at all", regime-nudge then asks "does THIS
// action in THIS regime specifically run hot or cold". Applying both is
// deliberate — one fixes the confidence scale itself, the other adds
// situational context on top of the now-corrected scale.
// ============================================================================

export const CONFIDENCE_BANDS: [number, number, string][] = [
  [50, 60, "50-59%"], [60, 70, "60-69%"], [70, 80, "70-79%"], [80, 90, "80-89%"], [90, 101, "90-100%"],
];

export interface CalibrationBucket {
  label: string; lo: number; hi: number;
  total: number; wins: number; winRate: number; avgStatedConfidence: number;
  gap: number; // avgStatedConfidence - winRate; positive = overconfident, negative = underconfident
  verdict: "well-calibrated" | "overconfident" | "underconfident" | "insufficient-data";
}

const WELL_CALIBRATED_TOLERANCE = 7; // percentage points — gaps within this are noise, not miscalibration

export async function computeCalibration(symbol?: string): Promise<CalibrationBucket[]> {
  const { db, ensureSchema } = await import("./db");
  await ensureSchema();
  const where: any = { status: { not: "OPEN" }, totalPnl: { not: null } };
  if (symbol && symbol !== "ALL") where.symbol = symbol;
  const trades = await db.tradeJournal.findMany({ where, select: { confidence: true, totalPnl: true } });

  return CONFIDENCE_BANDS.map(([lo, hi, label]) => {
    const bucketTrades = trades.filter(t => t.confidence >= lo && t.confidence < hi);
    const wins = bucketTrades.filter(t => (t.totalPnl ?? 0) > 0).length;
    const winRate = bucketTrades.length ? (wins / bucketTrades.length) * 100 : 0;
    const avgStatedConfidence = bucketTrades.length
      ? bucketTrades.reduce((s, t) => s + t.confidence, 0) / bucketTrades.length
      : (lo + Math.min(hi, 100) - 1) / 2;
    const gap = Number((avgStatedConfidence - winRate).toFixed(1));
    const verdict: CalibrationBucket["verdict"] =
      bucketTrades.length < MIN_SAMPLE_SIZE ? "insufficient-data"
      : Math.abs(gap) <= WELL_CALIBRATED_TOLERANCE ? "well-calibrated"
      : gap > 0 ? "overconfident" : "underconfident";
    return {
      label, lo, hi, total: bucketTrades.length, wins,
      winRate: Number(winRate.toFixed(1)), avgStatedConfidence: Number(avgStatedConfidence.toFixed(1)),
      gap, verdict,
    };
  });
}

export function findBucket(buckets: CalibrationBucket[], confidence: number): CalibrationBucket | null {
  return buckets.find(b => confidence >= b.lo && confidence < b.hi) ?? null;
}

// How much of the gap to actually correct for, per correction. Deliberately
// partial (not a full snap to the empirical win rate) — the empirical win
// rate itself is a noisy estimate off a limited sample, so fully trusting
// it would just trade one kind of overconfidence for another. 0.4 means a
// signal stated at 85% in a bucket that's actually only winning 60% of the
// time (a 25pt gap) gets pulled about 10 points toward reality, not the
// full 25.
const CALIBRATION_BLEND_WEIGHT = 0.4;

// Returns the corrected confidence + an optional note, or the original
// confidence unchanged (with note: null) if that bucket doesn't have enough
// data to trust yet, or is already well-calibrated.
export function applyCalibrationCorrection(confidence: number, buckets: CalibrationBucket[]): { confidence: number; note: string | null } {
  const bucket = findBucket(buckets, confidence);
  if (!bucket || bucket.verdict === "insufficient-data" || bucket.verdict === "well-calibrated") {
    return { confidence, note: null };
  }
  const corrected = confidence - bucket.gap * CALIBRATION_BLEND_WEIGHT;
  const rounded = Math.round(Math.max(0, Math.min(95, corrected)));
  if (rounded === confidence) return { confidence, note: null };
  return {
    confidence: rounded,
    note: `Calibration: signals stated at ${bucket.label} have actually won ${bucket.winRate}% of the time (${bucket.total} trades) — confidence adjusted from ${confidence}% to ${rounded}%`,
  };
}
