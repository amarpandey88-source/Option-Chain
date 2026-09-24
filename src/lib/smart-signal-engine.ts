import type { Regime, Sentiment, SignalStability, TimeframeSignal, TradeAction } from "./types";

export type SmartFactorKey =
  | "TIMEFRAME_CONSENSUS"
  | "MOMENTUM"
  | "VWAP"
  | "PCR"
  | "OI_FLOW"
  | "GEX"
  | "SMART_FLOW"
  | "REGIME"
  | "CROSS_MARKET"
  | "STABILITY";

export interface SmartFactor {
  key: SmartFactorKey;
  label: string;
  weight: number;
  score: number; // -100..+100, positive = bullish, negative = bearish
  contribution: number; // weighted contribution
  status: "BULLISH" | "BEARISH" | "NEUTRAL" | "NO_DATA";
  reason: string;
}

export interface SmartSignal {
  action: TradeAction;
  score: number; // 0..100 directional strength
  bullishScore: number;
  bearishScore: number;
  edge: number; // absolute directional separation
  confidence: number;
  quality: "A" | "B" | "C" | "WAIT";
  confirmed: boolean;
  factors: SmartFactor[];
  blockers: string[];
  summary: string;
  engineVersion: string;
}

const VERSION = "smart-v1.0";
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const signedStatus = (score: number, min = 12): SmartFactor["status"] =>
  score > min ? "BULLISH" : score < -min ? "BEARISH" : "NEUTRAL";

function factor(
  key: SmartFactorKey,
  label: string,
  weight: number,
  score: number,
  reason: string,
  noData = false,
): SmartFactor {
  const s = clamp(score, -100, 100);
  return {
    key, label, weight, score: Number(s.toFixed(1)),
    contribution: Number((s * weight / 100).toFixed(1)),
    status: noData ? "NO_DATA" : signedStatus(s),
    reason,
  };
}

function consensusScore(signals: Record<string, TimeframeSignal>): number {
  const weights: Record<string, number> = { "5min": 20, "15min": 30, "30min": 50 };
  let total = 0;
  for (const tf of ["5min", "15min", "30min"]) {
    const s = signals[tf];
    if (!s) continue;
    const direction = s.signal === "BUY CE" ? 1 : s.signal === "BUY PE" ? -1 : 0;
    total += direction * s.confidence * (weights[tf] / 100);
  }
  return clamp(total, -100, 100);
}

function rsiScore(signals: Record<string, TimeframeSignal>): number {
  const rsi = signals["5min"]?.rsi ?? 50;
  return clamp((rsi - 50) * 3.0, -100, 100);
}

export interface SmartSignalInput {
  signals: Record<string, TimeframeSignal>;
  candidate: TradeAction;
  pcr: number;
  smartFlow: number;
  gex: number;
  regime: Regime;
  vix: number;
  bankNiftyTrend: string;
  symbol: string;
  stability: SignalStability;
  painShift: number;
  atmCeOiChg: number;
  atmPeOiChg: number;
  sentiment: Sentiment;
}

export function computeSmartSignal(input: SmartSignalInput): SmartSignal {
  const {
    signals, candidate, pcr, smartFlow, gex, regime, vix,
    bankNiftyTrend, symbol, stability, painShift, atmCeOiChg, atmPeOiChg,
  } = input;

  const direction = candidate === "BUY CE" ? 1 : candidate === "BUY PE" ? -1 : 0;
  const factors: SmartFactor[] = [];

  const cs = consensusScore(signals);
  factors.push(factor(
    "TIMEFRAME_CONSENSUS", "5m / 15m / 30m consensus", 20, cs,
    cs > 20 ? "Higher timeframes support bullish direction." :
    cs < -20 ? "Higher timeframes support bearish direction." : "Timeframes are mixed.",
  ));

  const ms = rsiScore(signals);
  factors.push(factor(
    "MOMENTUM", "RSI + momentum", 10, ms,
    ms > 20 ? "Momentum is bullish." : ms < -20 ? "Momentum is bearish." : "Momentum is neutral.",
  ));

  const vwapScores = ["5min", "15min", "30min"].map(tf => signals[tf]?.vwapBias);
  const above = vwapScores.filter(v => v === "ABOVE").length;
  const below = vwapScores.filter(v => v === "BELOW").length;
  const vwapScore = clamp((above - below) * 50, -100, 100);
  factors.push(factor("VWAP", "Multi-timeframe VWAP", 10, vwapScore,
    above > below ? "Price is above VWAP on more timeframes." :
    below > above ? "Price is below VWAP on more timeframes." : "VWAP is mixed."));

  const pcrScore = clamp((pcr - 1) * 250, -100, 100);
  factors.push(factor("PCR", "Put/Call ratio", 10, pcrScore,
    pcr > 1.1 ? `PCR ${pcr.toFixed(2)} supports bullish positioning.` :
    pcr < 0.9 ? `PCR ${pcr.toFixed(2)} supports bearish positioning.` : "PCR is balanced."));

  const oiRaw = atmPeOiChg - atmCeOiChg;
  const oiScale = Math.max(100, Math.abs(atmPeOiChg) + Math.abs(atmCeOiChg));
  const oiScore = clamp((oiRaw / oiScale) * 100, -100, 100);
  const oiNoData = atmCeOiChg === 0 && atmPeOiChg === 0;
  factors.push(factor("OI_FLOW", "ATM OI flow", 15, oiScore,
    oiNoData ? "ATM OI change is unavailable for this refresh." :
    oiScore > 20 ? "Put OI is stronger than Call OI at ATM." :
    oiScore < -20 ? "Call OI is stronger than Put OI at ATM." : "ATM OI flow is mixed.",
    oiNoData));

  const gexScore = clamp(gex * 12, -100, 100);
  factors.push(factor("GEX", "Gamma exposure", 10, gexScore,
    gex > 0 ? "Positive GEX suggests a more stable dealer-gamma backdrop." :
    gex < 0 ? "Negative GEX suggests a more reactive/volatile backdrop." : "GEX is neutral.",
  ));

  const flowScore = clamp(smartFlow * 3, -100, 100);
  factors.push(factor("SMART_FLOW", "Smart money flow", 10, flowScore,
    smartFlow > 15 ? "Put-side OI buildup is stronger." :
    smartFlow < -15 ? "Call-side OI buildup is stronger." : "OI flow is balanced.",
  ));

  const regimeScore =
    regime === "TRENDING UP" ? 100 :
    regime === "TRENDING DOWN" ? -100 :
    regime === "VOLATILE" ? 0 : 0;
  factors.push(factor("REGIME", "Market regime", 10, regimeScore,
    regime === "TRENDING UP" ? "Trend regime supports bullish continuation." :
    regime === "TRENDING DOWN" ? "Trend regime supports bearish continuation." :
    regime === "VOLATILE" ? "Volatile regime: direction is less reliable." :
    "Rangebound regime: directional edge is limited.",
  ));

  let crossScore = 0;
  if (symbol !== "BANKNIFTY") {
    const bnBull = /BULLISH/.test(bankNiftyTrend);
    const bnBear = /BEARISH/.test(bankNiftyTrend);
    crossScore = bnBull ? 60 : bnBear ? -60 : 0;
  }
  factors.push(factor("CROSS_MARKET", "Bank Nifty confirmation", 5, crossScore,
    crossScore > 0 ? "Bank Nifty confirms the bullish side." :
    crossScore < 0 ? "Bank Nifty confirms the bearish side." : "Cross-market confirmation is neutral.",
  ));

  const stabilityScore = stability.currentAction === "BUY CE" ? 100 :
    stability.currentAction === "BUY PE" ? -100 : 0;
  const stabilityAdjusted = stability.consecutiveCount >= 3 ? stabilityScore :
    stability.consecutiveCount === 2 ? stabilityScore * 0.5 : stabilityScore * 0.25;
  factors.push(factor("STABILITY", "Signal stability", 10, stabilityAdjusted,
    stability.consecutiveCount >= 3
      ? `${stability.consecutiveCount} consecutive matching signals.`
      : `Only ${stability.consecutiveCount} consecutive matching signal(s).`,
  ));

  // painShift is intentionally a small tie-breaker inside the PCR/OI family;
  // it must not dominate the core signal.
  const painScore = clamp(painShift * 8, -30, 30);
  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  const raw = factors.reduce((s, f) => s + f.contribution, 0) + painScore * 0.05;
  const normalized = clamp((raw / totalWeight) * 100, -100, 100);
  const bullishScore = Math.round(clamp(50 + normalized / 2, 0, 100));
  const bearishScore = Math.round(clamp(50 - normalized / 2, 0, 100));
  const score = direction === 1 ? bullishScore : direction === -1 ? bearishScore : Math.max(bullishScore, bearishScore);
  const edge = Math.abs(bullishScore - bearishScore);

  const blockers: string[] = [];
  if (candidate === "WAIT") blockers.push("Base multi-timeframe engine is WAIT.");
  if (Math.max(bullishScore, bearishScore) < 62) blockers.push("Smart score is below the 62/100 confirmation threshold.");
  if (edge < 12) blockers.push("Bull/bear separation is too small.");
  if (regime === "RANGEBOUND") blockers.push("Rangebound regime reduces directional reliability.");
  if (regime === "VOLATILE" || vix >= 22) blockers.push("High-volatility regime requires extra confirmation.");
  if (stability.consecutiveCount < 2) blockers.push("Signal has not stabilized for at least two refreshes.");
  if (oiNoData) blockers.push("ATM OI change is unavailable; OI factor is neutral.");
  if (direction !== 0 && direction !== (normalized >= 0 ? 1 : -1)) blockers.push("Smart factors disagree with the base signal.");

  const confirmed = direction !== 0 &&
    ((direction === 1 ? bullishScore : bearishScore) >= 62) &&
    edge >= 12 &&
    stability.consecutiveCount >= 2 &&
    direction === (normalized >= 0 ? 1 : -1);

  const action: TradeAction = confirmed ? candidate : "WAIT";
  const confidence = Math.round(clamp(50 + score * 0.45 + (confirmed ? 5 : 0), 50, 95));
  const quality: SmartSignal["quality"] =
    action === "WAIT" ? "WAIT" :
    score >= 80 && edge >= 25 ? "A" :
    score >= 70 && edge >= 18 ? "B" : "C";

  const summary = action === "BUY CE"
    ? `Smart engine confirms BUY CE with ${score}/100 directional strength.`
    : action === "BUY PE"
      ? `Smart engine confirms BUY PE with ${score}/100 directional strength.`
      : blockers[0] ?? "Smart engine is waiting for stronger alignment.";

  return {
    action, score, bullishScore, bearishScore, edge, confidence, quality,
    confirmed, factors, blockers, summary, engineVersion: VERSION,
  };
}
