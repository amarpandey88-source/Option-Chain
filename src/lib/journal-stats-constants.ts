// Minimum closed trades a (regime, action) or other bucket needs before its
// win rate is considered meaningful enough to show or act on. Below this, a
// bucket showing "100%" or "0%" off 1-2 trades would be more misleading
// than useful — used both by the performance dashboard's breakdowns
// (src/app/api/trade-journal/stats/route.ts) and by the adaptive-confidence
// adjustment (src/lib/adaptive-confidence.ts) that feeds off the same data.
export const MIN_SAMPLE_SIZE = 8;
