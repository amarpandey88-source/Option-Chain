import { MIN_SAMPLE_SIZE } from "./journal-stats-constants";
import { computeCalibration, applyCalibrationCorrection } from "./confidence-calibration";
import type { OptionChainSnapshot } from "./types";

// ============================================================================
// Adaptive confidence — learns from the trade journal's own real outcomes
// ----------------------------------------------------------------------------
// Two independent, sequential corrections, both grounded in real closed
// trades from the journal — nothing here is a fixed rule decided in
// advance the way regime/expiry-day/Bank-Nifty adjustments are (see
// applyContextualAdjustments in yahoo-adapter.ts):
//
//  1. Calibration (src/lib/confidence-calibration.ts) — checks whether the
//     stated confidence SCALE itself is honest: do signals stated around
//     80% actually win about 80% of the time? If a whole confidence band
//     runs systematically hot or cold, this corrects toward what's
//     actually been happening before anything else touches the number.
//  2. Situational nudge (below) — on top of the now-calibrated number,
//     asks whether THIS specific (action, regime) combination in
//     particular has been running hotter or colder than its band overall.
//
// Both stages are deliberately conservative:
//  - Each needs its own MIN_SAMPLE_SIZE closed trades before touching
//    anything — a handful of trades is noise, not a pattern.
//  - Bounded adjustments — nudges an already-reasoned confidence, doesn't
//    override it.
//  - Same "confidence < 55 -> WAIT" downgrade rule the other adjustments
//    already use, checked once after both stages, so a combo with a
//    genuinely poor track record can still end up filtered out entirely.
//  - Fails silently (returns the snapshot unchanged) on any DB error — a
//    broken adaptive-confidence lookup should never take down the main
//    data feed.
// ============================================================================

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

export async function applyAdaptiveConfidence(snapshot: OptionChainSnapshot): Promise<OptionChainSnapshot> {
  if (snapshot.overallSignal.signal === "WAIT") return snapshot;
  try {
    const notes: string[] = [];
    let confidence = snapshot.overallSignal.confidence;

    // Stage 1: calibration correction
    const buckets = await computeCalibration();
    const calibrated = applyCalibrationCorrection(confidence, buckets);
    if (calibrated.note) { confidence = calibrated.confidence; notes.push(calibrated.note); }

    // Stage 2: situational (action, regime) win-rate nudge
    const { db, ensureSchema } = await import("./db");
    await ensureSchema();
    const matches = await db.tradeJournal.findMany({
      where: {
        status: { not: "OPEN" },
        totalPnl: { not: null },
        action: snapshot.overallSignal.signal,
        regime: snapshot.metrics.regime,
      },
      select: { totalPnl: true },
      take: 500,
    });
    if (matches.length >= MIN_SAMPLE_SIZE) {
      const wins = matches.filter(t => (t.totalPnl ?? 0) > 0).length;
      const winRate = wins / matches.length;
      let delta = 0;
      if (winRate >= 0.65) {
        delta = 5;
        notes.push(`Adaptive: ${snapshot.overallSignal.signal} in ${snapshot.metrics.regime} has won ${Math.round(winRate * 100)}% of your last ${matches.length} such trades — confidence nudged up`);
      } else if (winRate <= 0.35) {
        delta = -10;
        notes.push(`Adaptive: ${snapshot.overallSignal.signal} in ${snapshot.metrics.regime} has only won ${Math.round(winRate * 100)}% of your last ${matches.length} such trades — confidence trimmed`);
      }
      confidence += delta;
    }

    if (notes.length === 0) return snapshot;

    const newConfidence = Math.round(clamp(confidence, 0, 95));
    const downgrade = newConfidence < 55;
    const overallSignal = {
      ...snapshot.overallSignal,
      signal: downgrade ? ("WAIT" as const) : snapshot.overallSignal.signal,
      confidence: newConfidence,
      reasoning: [...snapshot.overallSignal.reasoning, ...notes, ...(downgrade ? ["Downgraded to WAIT — confidence fell below 55 after adaptive adjustment"] : [])],
    };
    return {
      ...snapshot,
      overallSignal,
      recommendation: {
        ...snapshot.recommendation,
        action: overallSignal.signal,
        confidence: overallSignal.confidence,
        rationale: `${snapshot.recommendation.rationale} ${notes.join(" ")}`,
      },
    };
  } catch (err) {
    console.error("[adaptive-confidence] lookup failed, leaving signal unchanged:", err);
    return snapshot;
  }
}
