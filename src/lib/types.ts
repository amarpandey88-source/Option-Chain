// ============================================================================
// Option Chain Analyzer — Type Definitions
// ============================================================================

export type Symbol = "NIFTY" | "BANKNIFTY" | "SENSEX";
export type Timeframe = "5min" | "15min" | "30min";
export type Sentiment =
  | "STRONG BULLISH"
  | "BULLISH"
  | "NEUTRAL"
  | "BEARISH"
  | "STRONG BEARISH";

export type TradeAction = "BUY CE" | "BUY PE" | "WAIT" | "EXIT";

export type Regime =
  | "TRENDING UP"
  | "TRENDING DOWN"
  | "RANGEBOUND"
  | "VOLATILE";

// ----------------------------------------------------------------------------
// Core metric snapshot — what is shown in the dashboard panels
// ----------------------------------------------------------------------------
export interface MetricSnapshot {
  symbol: Symbol;
  spot: number;
  prevSpot: number;
  pcr: number;
  indiaVix: number;
  vixStatus: "LOW" | "NORMAL" | "HIGH" | "EXTREME";
  smartFlow: number; // +ve = bullish money flow, -ve = bearish
  smartFlowAvailable: boolean; // false when the broker doesn't provide per-strike OI *change* data (e.g. ICICI, Groww) — smartFlow is then always 0, which is NOT a real reading and shouldn't be shown as one
  maxPain: number;
  prevMaxPain: number;
  painShift: number;
  gex: number; // in millions
  gammaFlip: number;
  trendScore: number; // 0-100
  bullProb: number; // 0-100
  bearProb: number; // 0-100
  bankNiftyScore: number; // 0-100
  bankNiftyTrend: "HIGH BULLISH" | "BULLISH" | "NEUTRAL" | "BEARISH" | "HIGH BEARISH";
  support: { level: number; strength: number }[];
  resistance: { level: number; strength: number }[];
  regime: Regime;
  updatedAt: string; // ISO timestamp
  atmStrike: number;
}

// ----------------------------------------------------------------------------
// ATM Greeks — for the at-the-money option
// ----------------------------------------------------------------------------
export interface ATMGreeks {
  delta: number;
  gamma: number;
  theta: number; // per day
  vega: number; // per 1% IV change
  iv: number; // implied volatility %
  interpretation: string;
}

// ----------------------------------------------------------------------------
// Timeframe-specific signal analysis
// ----------------------------------------------------------------------------
export interface TimeframeSignal {
  timeframe: Timeframe;
  trend: "UP" | "DOWN" | "FLAT";
  momentum: number; // -100 to +100
  rsi: number; // 0-100
  emaCross: "BULLISH" | "BEARISH" | "NEUTRAL"; // EMA9 vs EMA21
  vwapBias: "ABOVE" | "BELOW" | "AT";
  pcrTrend: "RISING" | "FALLING" | "FLAT";
  oiFlowBias: "CALL WRITING" | "PUT WRITING" | "NEUTRAL"; // smart money
  signal: TradeAction;
  confidence: number; // 0-100
  reasoning: string[];
}

// ----------------------------------------------------------------------------
// Trade recommendation
// ----------------------------------------------------------------------------
export interface TradeRecommendation {
  action: TradeAction;
  strike: number;
  optionType: "CE" | "PE";
  entry: number;
  stopLoss: number;
  target1: number;
  target2: number;
  target3: number;
  confidence: number; // 0-100
  riskReward: number;
  rationale: string;
  expiry: string;
  volume?: number; // contracts traded today at this strike/side — undefined if the data source doesn't provide it
  lowLiquidity: boolean; // true if volume is below a safe minimum (illiquid — wide spreads, hard to exit)
  ltp?: number; // real, actual last-traded-price at this strike/side right now. `entry` is set equal to this whenever it's available (>0) so the suggested trade is actually fillable; entry only falls back to a theoretical Black-Scholes fair-value estimate when no real LTP exists yet for the strike.
}

// ----------------------------------------------------------------------------
// Option chain row
// ----------------------------------------------------------------------------
export interface OptionChainRow {
  strike: number;
  ceLtp: number;
  ceOi: number;
  ceOiChg: number;
  ceIv: number;
  ceVolume?: number;
  peLtp: number;
  peOi: number;
  peOiChg: number;
  peIv: number;
  peVolume?: number;
  isATM: boolean;
  // Broker's own raw trading symbol for this leg (only populated for Fyers
  // right now) — lets the live tick-stream WebSocket subscribe to the
  // EXACT real symbol string the broker itself uses, instead of trying to
  // reconstruct a strike/expiry symbol format client-side and risking a
  // mismatch. undefined for Yahoo mode and every other broker.
  ceFySymbol?: string;
  peFySymbol?: string;
}

// ----------------------------------------------------------------------------
// Signal stability — how long has the current signal been consistent?
// ----------------------------------------------------------------------------
export interface SignalStability {
  currentAction: TradeAction;
  consecutiveCount: number;
  stableSeconds: number;
  isLocked: boolean;
  history: { ts: number; action: TradeAction; confidence: number }[];
}

// ----------------------------------------------------------------------------
// Full snapshot returned by the API
// ----------------------------------------------------------------------------
export interface OptionChainSnapshot {
  metrics: MetricSnapshot;
  greeks: ATMGreeks;
  signals: Record<Timeframe, TimeframeSignal>;
  overallSignal: TimeframeSignal;
  recommendation: TradeRecommendation;
  chain: OptionChainRow[];
  history: {
    spot: { t: string; v: number }[];
    pcr: { t: string; v: number }[];
    vix: { t: string; v: number }[];
  };
  sentiment: Sentiment;
  signalStability: SignalStability;
  candlePattern: { name: string; type: "bullish" | "bearish" | "neutral"; description: string } | null;
}
