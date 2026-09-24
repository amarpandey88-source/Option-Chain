import { OptionChainRow, OptionChainSnapshot, Regime, Sentiment, SignalStability, Symbol, Timeframe, TimeframeSignal, TradeAction, TradeRecommendation, ATMGreeks } from "./types";
import { getDefaultExpiry, daysUntil } from "./expiry-utils";
import { computeSmartSignal } from "./smart-signal-engine";

// NOTE on lot sizes / strike steps: exchanges revise these periodically via
// circular (NSE rebased index lot sizes for the Jan-2026 series; BSE raised
// Sensex's lot size from 10 to 20 in 2025). Values below are current as of
// this writing — verify against the exchange's live contract spec if trades
// ever look off by a multiple.
const YAHOO_SYMBOL: Record<Symbol, string> = { NIFTY: "^NSEI", BANKNIFTY: "^NSEBANK", SENSEX: "^BSESN" };
const STRIKE_STEP: Record<Symbol, number> = { NIFTY: 50, BANKNIFTY: 100, SENSEX: 100 };

// How many strikes ITM (in-the-money) to pick for the actual trade entry,
// instead of ATM. An ITM option has a higher delta than ATM (moves more
// rupees per point the underlying moves), so the SAME spot move produces a
// bigger, faster premium gain — directly what "movement ka zyada benefit"
// means. One strike ITM is the standard, conservative choice for this:
// noticeably higher delta than ATM without paying deep-ITM prices or
// giving up the liquidity ATM/near-ATM strikes have. Exported so both the
// Yahoo and broker-adapter (real Fyers/etc data) paths use the identical
// rule rather than risking two slightly different definitions of "ITM".
export const ITM_STRIKES_FOR_ENTRY = 1;

// isCall=true (BUY CE) → ITM means spot is ABOVE the strike → pick a LOWER
// strike than ATM. isCall=false (BUY PE) → ITM means spot is BELOW the
// strike → pick a HIGHER strike than ATM.
export function pickEntryStrike(atmStrike: number, step: number, isCall: boolean): number {
  return isCall ? atmStrike - step * ITM_STRIKES_FOR_ENTRY : atmStrike + step * ITM_STRIKES_FOR_ENTRY;
}
const LOT_SIZE: Record<Symbol, number> = { NIFTY: 65, BANKNIFTY: 30, SENSEX: 20 };
const SYMBOL_BASE: Record<Symbol, number> = { NIFTY: 24000, BANKNIFTY: 52000, SENSEX: 80000 };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface CacheEntry { ts: number; data: OptionChainSnapshot; }
const cache: Partial<Record<string, CacheEntry>> = {};
const CACHE_TTL_MS = 4000;

export interface Candle { open: number; high: number; low: number; close: number; volume: number; ts: number; }
interface YahooQuote { spot: number; prevClose: number; closes: number[]; vix: number; bankNifty: number; candles: Candle[]; }

async function fetchYahooQuote(symbol: Symbol): Promise<YahooQuote | null> {
  const ySymbol = YAHOO_SYMBOL[symbol];
  try {
    const [underlyingRes, vixRes, bankRes] = await Promise.all([
      fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySymbol)}?interval=5m&range=5d`, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } }),
      fetch(`https://query1.finance.yahoo.com/v8/finance/chart/%5EINDIAVIX?interval=5m&range=1d`, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } }),
      symbol === "NIFTY" ? fetch(`https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEBANK?interval=5m&range=1d`, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } }) : Promise.resolve(null),
    ]);
    if (!underlyingRes.ok) return null;
    const uj = await underlyingRes.json(); const ur = uj?.chart?.result?.[0]; if (!ur) return null;
    const meta = ur.meta; const q = ur.indicators?.quote?.[0] ?? {};
    const closes: number[] = (q.close ?? []).filter((v: number | null) => v != null);
    const timestamps: number[] = ur.timestamp ?? [];
    const candles: Candle[] = [];
    for (let i = 0; i < closes.length; i++) {
      const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
      if (o != null && h != null && l != null && c != null) {
        candles.push({ open: o, high: h, low: l, close: c, volume: q.volume?.[i] ?? 0, ts: (timestamps[i] ?? 0) * 1000 });
      }
    }
    let vix = 13.5;
    if (vixRes.ok) { const vj = await vixRes.json(); if (vj?.chart?.result?.[0]?.meta?.regularMarketPrice) vix = vj.chart.result[0].meta.regularMarketPrice; }
    let bankNifty = 52000;
    if (bankRes && (bankRes as Response).ok) { const bj = await (bankRes as Response).json(); if (bj?.chart?.result?.[0]?.meta?.regularMarketPrice) bankNifty = bj.chart.result[0].meta.regularMarketPrice; }
    return { spot: meta.regularMarketPrice ?? closes[closes.length - 1] ?? SYMBOL_BASE[symbol], prevClose: meta.chartPreviousClose ?? closes[closes.length - 2] ?? SYMBOL_BASE[symbol], closes, vix, bankNifty, candles };
  } catch (err) { console.error("[yahoo] fetch error:", err); return null; }
}

// Historical candles over a longer, configurable range — used by the
// backtest engine (src/lib/backtest-engine.ts), separate from
// fetchYahooQuote's fixed 5-day/5-min window used for live signals. Yahoo
// caps how far back intraday intervals go (15m tops out around 60 days in
// practice), so this is naturally limited to a few months at most.
export async function fetchYahooHistoricalCandles(symbol: Symbol, rangeDays: number): Promise<Candle[]> {
  const ySymbol = YAHOO_SYMBOL[symbol];
  const range = rangeDays <= 7 ? "1mo" : rangeDays <= 30 ? "2mo" : "3mo"; // Yahoo wants a coarse enum here, not an exact day count
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySymbol)}?interval=15m&range=${range}`,
    { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } }
  );
  if (!res.ok) throw new Error(`Yahoo historical fetch failed: HTTP ${res.status}`);
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error("Yahoo historical fetch: unexpected response shape");
  const q = r.indicators?.quote?.[0] ?? {};
  const timestamps: number[] = r.timestamp ?? [];
  const candles: Candle[] = [];
  const cutoff = Date.now() - rangeDays * 24 * 60 * 60 * 1000;
  for (let i = 0; i < timestamps.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    const ts = timestamps[i] * 1000;
    if (o != null && h != null && l != null && c != null && ts >= cutoff) {
      candles.push({ open: o, high: h, low: l, close: c, volume: q.volume?.[i] ?? 0, ts });
    }
  }
  return candles;
}


interface YahooState {
  symbol: Symbol; pcr: number; vixPrev: number; spotPrev: number; driftBias: number;
  chain: OptionChainRow[]; closes: number[]; spotHistory: { t: string; v: number }[];
  pcrHistory: { t: string; v: number }[]; vixHistory: { t: string; v: number }[];
  maxPain: number; prevMaxPain: number;
  signalHistory: { ts: number; action: TradeAction; confidence: number }[];
}
const yahooState: Partial<Record<Symbol, YahooState>> = {};

function initYahooState(symbol: Symbol): YahooState {
  const base = SYMBOL_BASE[symbol]; const step = STRIKE_STEP[symbol];
  const atm = Math.round(base / step) * step; const now = Date.now();
  const chain: OptionChainRow[] = [];
  for (let i = -5; i <= 5; i++) { const strike = atm + i * step; const moneyness = Math.abs(strike - base) / base; const baseIv = 13 + moneyness * 50; const prox = Math.exp(-moneyness * 60); const bo = symbol === "BANKNIFTY" ? 6000 : 4000; chain.push({ strike, ceLtp: Number(Math.max(0.5, Math.max(base - strike, 0) + base * 0.004).toFixed(2)), ceOi: Math.round(bo * prox * (i >= 0 ? 1.3 : 0.8)), ceOiChg: 0, ceIv: Number(baseIv.toFixed(2)), peLtp: Number(Math.max(0.5, Math.max(strike - base, 0) + base * 0.004).toFixed(2)), peOi: Math.round(bo * prox * (i <= 0 ? 1.4 : 0.7)), peOiChg: 0, peIv: Number(baseIv.toFixed(2)), isATM: false }); }
  return { symbol, pcr: 1.0, vixPrev: 13.5, spotPrev: base, driftBias: 0, chain, closes: [], spotHistory: Array.from({ length: 30 }, (_, i) => ({ t: new Date(now - (30 - i) * 5000).toISOString(), v: base })), pcrHistory: Array.from({ length: 30 }, (_, i) => ({ t: new Date(now - (30 - i) * 5000).toISOString(), v: 1.0 })), vixHistory: Array.from({ length: 30 }, (_, i) => ({ t: new Date(now - (30 - i) * 5000).toISOString(), v: 13.5 })), maxPain: atm, prevMaxPain: atm, signalHistory: [] };
}

function evolveChain(state: YahooState, spot: number) {
  const step = STRIKE_STEP[state.symbol]; const atm = Math.round(spot / step) * step;
  let totalCe = 0, totalPe = 0;
  for (const row of state.chain) {
    row.isATM = row.strike === atm;
    const moneyness = Math.abs(row.strike - spot) / spot;
    const baseCe = Math.max(0.5, Math.max(spot - row.strike, 0) + spot * 0.004 * (1 - moneyness * 5));
    const baseGe = Math.max(0.5, Math.max(row.strike - spot, 0) + spot * 0.004 * (1 - moneyness * 5));
    // Small bid-ask/theta-style jitter so premiums don't look robotically
    // frozen between refreshes when spot barely moves — this is still an
    // estimate (labeled as such in the UI), just less mechanically static.
    row.ceLtp = Number(Math.max(0.5, baseCe * (1 + (Math.random() - 0.5) * 0.03)).toFixed(2));
    row.peLtp = Number(Math.max(0.5, baseGe * (1 + (Math.random() - 0.5) * 0.03)).toFixed(2));
    const targetIv = state.vixPrev + moneyness * 30;
    row.ceIv = Number((row.ceIv + (targetIv - row.ceIv) * 0.2).toFixed(2));
    row.peIv = Number((row.peIv + (targetIv - row.peIv) * 0.2).toFixed(2));
    const sd = spot - state.spotPrev; const ds = sd > 0 ? 1 : sd < 0 ? -1 : state.driftBias;
    state.driftBias = state.driftBias * 0.85 + ds * 0.15;
    const prox = Math.exp(-moneyness * 60); const bf = 80 * prox * (state.symbol === "BANKNIFTY" ? 1.5 : 1);
    const cf = -state.driftBias * bf + (Math.random() - 0.5) * bf * 0.6; const pf = state.driftBias * bf + (Math.random() - 0.5) * bf * 0.6;
    row.ceOiChg = Math.round(row.ceOiChg * 0.7 + cf); row.peOiChg = Math.round(row.peOiChg * 0.7 + pf);
    row.ceOi = Math.max(100, row.ceOi + Math.round(cf * 0.3)); row.peOi = Math.max(100, row.peOi + Math.round(pf * 0.3));
    // Synthetic volume: roughly proportional to OI, peaking near ATM like
    // real markets — same "estimated, not real" status as the rest of
    // this view-only chain.
    row.ceVolume = Math.max(10, Math.round(row.ceOi * (0.4 + Math.random() * 0.4) * prox * 2 + row.ceOi * 0.05));
    row.peVolume = Math.max(10, Math.round(row.peOi * (0.4 + Math.random() * 0.4) * prox * 2 + row.peOi * 0.05));
    totalCe += row.ceOiChg; totalPe += row.peOiChg;
  }
  return { totalCeOiChg: totalCe, totalPeOiChg: totalPe };
}

function computeMaxPain(chain: OptionChainRow[]): number {
  let minP = Infinity, mp = chain[0].strike;
  for (const row of chain) { let pain = 0; for (const r of chain) { if (r.strike < row.strike) pain += (row.strike - r.strike) * r.ceOi; else if (r.strike > row.strike) pain += (r.strike - row.strike) * r.peOi; } if (pain < minP) { minP = pain; mp = row.strike; } }
  return mp;
}

export function calcRsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let g = 0, l = 0;
  for (let i = closes.length - period; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; }
  if (l === 0) return 100; return 100 - 100 / (1 + g / period / (l / period));
}
export function calcEma(v: number[], p: number): number { if (!v.length) return 0; const k = 2 / (p + 1); let e = v[0]; for (let i = 1; i < v.length; i++) e = v[i] * k + e * (1 - k); return e; }

export function computeTFS(tf: Timeframe, closes: number[], pcr: number, vw: "ABOVE" | "BELOW" | "AT", of: "CALL WRITING" | "PUT WRITING" | "NEUTRAL", pt: "RISING" | "FALLING" | "FLAT", pattern?: CandlePattern | null): TimeframeSignal {
  const sm: Record<Timeframe, number> = { "5min": 1, "15min": 3, "30min": 6 }; const s = sm[tf];
  const samp: number[] = []; for (let i = closes.length - 1; i >= 0; i -= s) { samp.unshift(closes[i]); if (samp.length >= 50) break; }
  if (samp.length < 5) samp.push(...closes.slice(-5));
  const rsi = calcRsi(samp, Math.min(14, samp.length - 1));
  const e9 = calcEma(samp.slice(-30), Math.min(9, samp.length)); const e21 = calcEma(samp.slice(-50), Math.min(21, samp.length));
  const ec = e9 > e21 * 1.0005 ? "BULLISH" : e9 < e21 * 0.9995 ? "BEARISH" : "NEUTRAL";
  const l5 = samp.slice(-5); const mom = ((l5[l5.length - 1] - l5[0]) / l5[0]) * 100 * 10;
  const trend = mom > 0.1 ? "UP" : mom < -0.1 ? "DOWN" : "FLAT";
  let bs = 0, br = 0; const reason: string[] = [];
  if (rsi > 60) { bs += 2; reason.push(`RSI ${rsi.toFixed(0)} bullish`); } else if (rsi < 40) { br += 2; reason.push(`RSI ${rsi.toFixed(0)} bearish`); } else reason.push(`RSI ${rsi.toFixed(0)} neutral`);
  if (ec === "BULLISH") { bs += 2; reason.push("EMA9 > EMA21"); } else if (ec === "BEARISH") { br += 2; reason.push("EMA9 < EMA21"); }
  if (vw === "ABOVE") { bs += 1; reason.push("Above VWAP"); } else if (vw === "BELOW") { br += 1; reason.push("Below VWAP"); }
  if (pcr > 1.2) { bs += 1; reason.push(`PCR ${pcr} > 1.2`); } else if (pcr < 0.8) { br += 1; reason.push(`PCR ${pcr} < 0.8`); }
  if (pt === "RISING") { bs += 1; reason.push("PCR rising"); } else if (pt === "FALLING") { br += 1; reason.push("PCR falling"); }
  if (of === "PUT WRITING") { bs += 2; reason.push("Put writing"); } else if (of === "CALL WRITING") { br += 2; reason.push("Call writing"); }
  // Candlestick pattern on the latest candle only actually describes what
  // just happened on THIS timeframe's bar, so it's only meaningful for the
  // fastest (5-min) timeframe here — a 15/30-min "signal" is built from
  // resampled closes, not from a real 15/30-min candle, so attaching the
  // pattern there would misrepresent what it's evidence of. Previously this
  // was detected but never actually fed into any signal or confidence score.
  if (pattern && tf === "5min") {
    if (pattern.type === "bullish") { bs += 1; reason.push(`Candle: ${pattern.name} (bullish)`); }
    else if (pattern.type === "bearish") { br += 1; reason.push(`Candle: ${pattern.name} (bearish)`); }
  }
  const net = bs - br; let sig: TradeAction = "WAIT"; let conf = 50;
  if (net >= 4) { sig = net > 0 ? "BUY CE" : "BUY PE"; conf = clamp(60 + Math.abs(net) * 5, 60, 92); }
  else if (net >= 2) { sig = "BUY CE"; conf = clamp(55 + net * 3, 55, 72); }
  else if (net <= -4) { sig = "BUY PE"; conf = clamp(60 + Math.abs(net) * 5, 60, 92); }
  else if (net <= -2) { sig = "BUY PE"; conf = clamp(55 + Math.abs(net) * 3, 55, 72); }
  return { timeframe: tf, trend, momentum: Number(clamp(mom, -100, 100).toFixed(2)), rsi: Number(rsi.toFixed(1)), emaCross: ec, vwapBias: vw, pcrTrend: pt, oiFlowBias: of, signal: sig, confidence: Math.round(conf), reasoning: reason };
}

export function aggS(signals: TimeframeSignal[]): TimeframeSignal {
  const w = [0.2, 0.3, 0.5]; let wM = 0, wR = 0, wC = 0, b = 0, r = 0;
  signals.forEach((s, i) => { wM += s.momentum * w[i]; wR += s.rsi * w[i]; wC += s.confidence * w[i]; if (s.signal === "BUY CE") b++; else if (s.signal === "BUY PE") r++; });
  let sig: TradeAction = "WAIT";
  if (b === 3) sig = "BUY CE"; else if (r === 3) sig = "BUY PE"; else if (b === 2 && signals[2].signal === "BUY CE") sig = "BUY CE"; else if (r === 2 && signals[2].signal === "BUY PE") sig = "BUY PE";
  const base = signals[2];
  return { timeframe: "30min", trend: base.trend, momentum: Number(wM.toFixed(2)), rsi: Number(wR.toFixed(1)), emaCross: base.emaCross, vwapBias: base.vwapBias, pcrTrend: base.pcrTrend, oiFlowBias: base.oiFlowBias, signal: sig, confidence: Math.round(wC), reasoning: [`5min: ${signals[0].signal} (${signals[0].confidence}%)`, `15min: ${signals[1].signal} (${signals[1].confidence}%)`, `30min: ${signals[2].signal} (${signals[2].confidence}%)`, `Consensus: ${b} bull / ${r} bear`] };
}

// ----------------------------------------------------------------------------
// Contextual adjustments — regime, expiry-day, and cross-market confirmation
// ----------------------------------------------------------------------------
// The raw per-timeframe consensus above (aggS) only looks at price-derived
// indicators in isolation. Three real-world factors it ignores entirely,
// each a common cause of a "valid-looking" signal getting stopped out:
//
//  1. Regime: the exact same net indicator score means something different
//     in a rangebound market (more likely noise/chop) than in a trending
//     one (more likely a real move). RANGEBOUND/VOLATILE regimes get a
//     confidence haircut; TRENDING regimes are left alone.
//  2. Expiry day: gamma/theta behave erratically in the last hours before
//     expiry — a signal that's fine on a normal day is less trustworthy
//     the exact same way on expiry day.
//  3. Cross-market confirmation: Bank Nifty carries roughly a third of
//     Nifty's own index weight, so if it's independently trending the
//     opposite direction of a Nifty signal, that's a real divergence
//     warning the single-index indicators above never see. When they
//     agree instead, that's genuine corroborating evidence, not noise —
//     small confidence boost.
//
// None of this invents a new trade signal — it only ever moves the same
// signal's confidence up or down, and downgrades to WAIT once confidence
// drops under 55 (the same floor the base scoring already used for its
// weakest tier) rather than ever creating a signal that wasn't already
// there from the indicators themselves.
export function applyContextualAdjustments(
  os: TimeframeSignal,
  regime: Regime,
  daysToExpiry: number,
  symbol: Symbol,
  bankNiftyTrend: "HIGH BULLISH" | "BULLISH" | "NEUTRAL" | "BEARISH" | "HIGH BEARISH",
  flow?: {
    priceUp: boolean;
    atmCeOiChg: number;
    atmPeOiChg: number;
    lastCandle?: Candle;
  }
): TimeframeSignal {
  if (os.signal === "WAIT") return os;
  let conf = os.confidence;
  const notes: string[] = [];

  if (regime === "RANGEBOUND") {
    conf -= 8;
    notes.push("Rangebound regime — confidence trimmed (chop risk)");
  } else if (regime === "VOLATILE") {
    conf -= 10;
    notes.push("Volatile regime (high VIX) — confidence trimmed (whipsaw risk)");
  }

  if (daysToExpiry === 0) {
    conf -= 10;
    notes.push("Expiry day — confidence trimmed (erratic gamma/theta)");
  }

  // Bank Nifty as a cross-check only makes sense as a confirmation of a
  // DIFFERENT index, not of itself.
  if (symbol !== "BANKNIFTY") {
    const wantsBull = os.signal === "BUY CE";
    const bnBearish = bankNiftyTrend === "BEARISH" || bankNiftyTrend === "HIGH BEARISH";
    const bnBullish = bankNiftyTrend === "BULLISH" || bankNiftyTrend === "HIGH BULLISH";
    if ((wantsBull && bnBearish) || (!wantsBull && bnBullish)) {
      conf -= 10;
      notes.push(`Bank Nifty diverging (${bankNiftyTrend}) — confidence trimmed`);
    } else if ((wantsBull && bnBullish) || (!wantsBull && bnBearish)) {
      conf += 3;
      notes.push(`Bank Nifty confirms (${bankNiftyTrend})`);
    }
  }

  // Is the price move genuine buildup, or just covering/unwinding? A
  // green candle with CALL OI actually FALLING isn't fresh call buying —
  // it's short covering (shorts closing out), which tends to run out of
  // steam faster than real fresh buying. Same logic in reverse for PUTs
  // on a down move. Only evaluated when price is actually moving in the
  // signal's own direction — this isn't a second "does price agree with
  // the signal" check, it's "is the move backed by real OI buildup".
  // Zero OI change (no real per-strike OI available, e.g. some brokers)
  // is treated as "no information" and skipped rather than misread as
  // "OI falling".
  if (flow) {
    const wantsBull = os.signal === "BUY CE";
    const priceMovesWithSignal = wantsBull ? flow.priceUp : !flow.priceUp;
    const relevantOiChg = wantsBull ? flow.atmCeOiChg : flow.atmPeOiChg;
    if (priceMovesWithSignal && relevantOiChg !== 0) {
      const legName = wantsBull ? "Call" : "Put";
      if (relevantOiChg > 0) {
        conf += 3;
        notes.push(`ATM ${legName} OI rising with price — looks like genuine fresh buildup, not just covering`);
      } else {
        conf -= 6;
        notes.push(`ATM ${legName} OI falling despite the price move — looks like ${wantsBull ? "short-covering" : "long-unwinding"} rather than fresh buildup, confidence trimmed`);
      }
    }

    // Where did the last candle actually close within its own range? A
    // weak close (near the low on an up move, or near the high on a down
    // move) tempers confidence even if the candle's own color agrees with
    // the signal — the color alone hides this; the close position doesn't.
    const c = flow.lastCandle;
    if (c && c.high > c.low) {
      const closePos = (c.close - c.low) / (c.high - c.low); // 0 = closed at the low, 1 = closed at the high
      if (wantsBull && closePos < 0.3) {
        conf -= 5;
        notes.push("Last candle closed near its low — weak close tempers bullish confidence");
      } else if (wantsBull && closePos > 0.7) {
        conf += 2;
        notes.push("Last candle closed near its high — confirms bullish momentum");
      } else if (!wantsBull && closePos > 0.7) {
        conf -= 5;
        notes.push("Last candle closed near its high — weak close tempers bearish confidence");
      } else if (!wantsBull && closePos < 0.3) {
        conf += 2;
        notes.push("Last candle closed near its low — confirms bearish momentum");
      }
    }
  }

  conf = clamp(conf, 0, 95);
  if (conf < 55) {
    return {
      ...os, signal: "WAIT", confidence: Math.round(conf),
      reasoning: [...os.reasoning, ...notes, "Downgraded to WAIT — confidence fell below 55 after contextual adjustments"],
    };
  }
  return { ...os, confidence: Math.round(conf), reasoning: [...os.reasoning, ...notes] };
}

// ----------------------------------------------------------------------------
// Shared signal-context builder — used by generateSnapshotYahoo (below) AND
// by broker-adapter.ts's Fyers real-market-data path, so both compute the
// exact same RSI/EMA/VWAP/regime/sentiment formulas, just fed with
// different inputs (Yahoo's own quote vs Fyers' real quotes+candles+OI).
// Mirrors the inline logic generateSnapshotYahoo already used internally —
// pulled out here so a second, independently-verified real-data source
// (Fyers) can reuse it exactly rather than re-implementing (and risking
// silently drifting from) the same formulas a second time.
// ----------------------------------------------------------------------------
export interface SignalContextInput {
  symbol: Symbol;
  closes: number[];
  candles: Candle[];
  spot: number;
  prevClose: number;
  pcr: number;
  pcrHistory: { t: string; v: number }[];
  smartFlow: number;
  vix: number;
  bankNifty: number;
  bankNiftyBaseline?: number;
  daysToExpiry: number;
  // ATM strike's own CE/PE open-interest change — lets the confidence
  // adjustment below tell "price moved because of genuine fresh buildup"
  // apart from "price moved but it's really just short-covering/unwinding"
  // (see applyContextualAdjustments). Pass 0 for both if unavailable
  // (e.g. a data source with no real per-strike OI) — the check simply
  // no-ops on exactly-zero input rather than misfiring on absence of data.
  atmCeOiChg: number;
  atmPeOiChg: number;
  // Mutated in place (pushed to + trimmed) — same pattern the internal
  // per-symbol state object already uses for signal-stability tracking.
  signalHistory: { ts: number; action: TradeAction; confidence: number }[];
}

export interface SignalContextResult {
  signals: Record<Timeframe, TimeframeSignal>;
  overallSignal: TimeframeSignal;
  regime: Regime;
  sentiment: Sentiment;
  trendScore: number;
  bullProb: number;
  bankNiftyScore: number;
  bankNiftyTrend: "HIGH BULLISH" | "BULLISH" | "NEUTRAL" | "BEARISH" | "HIGH BEARISH";
  candlePattern: CandlePattern | null;
  signalStability: SignalStability;
}

export function computeSignalContext(input: SignalContextInput): SignalContextResult {
  const { symbol, closes, candles, spot, prevClose, pcr, pcrHistory, smartFlow, vix, bankNifty, daysToExpiry, atmCeOiChg, atmPeOiChg, signalHistory } = input;
  const vwapValue = computeVWAP(candles);
  const vw: "ABOVE" | "BELOW" | "AT" = vwapValue == null
    ? (spot > prevClose * 1.001 ? "ABOVE" : spot < prevClose * 0.999 ? "BELOW" : "AT")
    : spot > vwapValue * 1.0005 ? "ABOVE" : spot < vwapValue * 0.9995 ? "BELOW" : "AT";
  const of: "CALL WRITING" | "PUT WRITING" | "NEUTRAL" = smartFlow > 15 ? "PUT WRITING" : smartFlow < -15 ? "CALL WRITING" : "NEUTRAL";
  const ph = pcrHistory.slice(-6);
  const pt: "RISING" | "FALLING" | "FLAT" = ph.length >= 3 && ph[ph.length - 1].v > ph[0].v + 0.03 ? "RISING" : ph.length >= 3 && ph[ph.length - 1].v < ph[0].v - 0.03 ? "FALLING" : "FLAT";
  const pattern = detectCandlePattern(candles);
  const s5 = computeTFS("5min", closes, pcr, vw, of, pt, pattern);
  const s15 = computeTFS("15min", closes, pcr, vw, of, pt);
  const s30 = computeTFS("30min", closes, pcr, vw, of, pt);
  const rsi5 = s5.rsi;
  const ts = Math.round(clamp(50 + (rsi5 - 50) * 0.8 + smartFlow * 0.3, 5, 95));
  const bp = Math.round(clamp(50 + (rsi5 - 50) * 0.7 + smartFlow * 0.2, 5, 95));
  const baseline = input.bankNiftyBaseline ?? 57542.9;
  const bnc = ((bankNifty - baseline) / baseline) * 100;
  const bns = Math.round(clamp(50 + bnc * 8, 5, 95));
  const bnt = bns > 75 ? "HIGH BULLISH" : bns > 60 ? "BULLISH" : bns > 40 ? "NEUTRAL" : bns > 25 ? "BEARISH" : "HIGH BEARISH";
  const regime: Regime = vix > 18 ? "VOLATILE" : ts > 70 && smartFlow > 0 ? "TRENDING UP" : ts < 30 && smartFlow < 0 ? "TRENDING DOWN" : "RANGEBOUND";
  const osRaw = aggS([s5, s15, s30]);
  const overallSignal = applyContextualAdjustments(osRaw, regime, daysToExpiry, symbol, bnt, {
    priceUp: spot > prevClose, atmCeOiChg, atmPeOiChg, lastCandle: candles[candles.length - 1],
  });
  signalHistory.push({ ts: Date.now(), action: overallSignal.signal, confidence: overallSignal.confidence });
  if (signalHistory.length > 20) signalHistory.shift();
  const signalStability = computeSS(signalHistory);
  const sentiment: Sentiment = (() => {
    const sc = bp * 0.5 + ts * 0.3 + (smartFlow + 50) * 0.2;
    if (sc > 80) return "STRONG BULLISH"; if (sc > 60) return "BULLISH";
    if (sc < 20) return "STRONG BEARISH"; if (sc < 40) return "BEARISH";
    return "NEUTRAL";
  })();
  return {
    signals: { "5min": s5, "15min": s15, "30min": s30 }, overallSignal, regime, sentiment,
    trendScore: ts, bullProb: bp, bankNiftyScore: bns, bankNiftyTrend: bnt,
    candlePattern: pattern, signalStability,
  };
}

export function computeSS(history: { ts: number; action: TradeAction; confidence: number }[]): SignalStability {
  if (!history.length) return { currentAction: "WAIT", consecutiveCount: 0, stableSeconds: 0, isLocked: false, history: [] };
  const last = history[history.length - 1]; let c = 1;
  for (let i = history.length - 2; i >= 0; i--) { if (history[i].action === last.action) c++; else break; }
  const ss = history.length - c; const secs = Math.round((Date.now() - (history[ss]?.ts ?? Date.now())) / 1000);
  return { currentAction: last.action, consecutiveCount: c, stableSeconds: secs, isLocked: c >= 3 && last.action !== "WAIT", history: [...history] };
}

export function getNextExpiry(symbol: Symbol, overrideIso?: string): { date: Date; daysToExpiry: number; label: string } {
  if (overrideIso) {
    const date = new Date(overrideIso + "T15:30:00");
    return { date, daysToExpiry: daysUntil(overrideIso), label: date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) };
  }
  const { iso, label } = getDefaultExpiry(symbol);
  return { date: new Date(iso + "T15:30:00"), daysToExpiry: daysUntil(iso), label };
}

// Approximation of the standard normal CDF (same tanh-based approximation
// used throughout this file for consistency between displayed Greeks and
// the theoretical premium below).
const normCdf = (x: number) => 0.5 * (1 + Math.tanh(x * 0.7978));

function d1d2(spot: number, strike: number, iv: number, T: number) {
  const s = Math.max(iv, 1) / 100;
  const t = Math.max(T, 0.5 / 365);
  const d1 = (Math.log(spot / strike) + (0.05 + 0.5 * s * s) * t) / (s * Math.sqrt(t));
  const d2 = d1 - s * Math.sqrt(t);
  return { d1, d2, s, t };
}

export function computeGreeks(spot: number, atm: number, iv: number, daysToExpiry = 4): ATMGreeks {
  const { d1, s, t } = d1d2(spot, atm, iv, daysToExpiry / 365);
  const delta = Number(normCdf(d1).toFixed(2));
  const gamma = Number((Math.exp(-d1 * d1 / 2) / (spot * s * Math.sqrt(t) * 2.5066)).toFixed(5));
  const theta = Number((-(spot * s * Math.exp(-d1 * d1 / 2)) / (2 * 2.5066 * Math.sqrt(t)) / 365).toFixed(2));
  const vega = Number(((spot * Math.exp(-d1 * d1 / 2) * Math.sqrt(t)) / 100).toFixed(2));
  return { delta, gamma, theta, vega, iv, interpretation: delta > 0.6 ? `Delta ${delta}, ITM` : delta < 0.4 ? `Delta ${delta}, OTM` : `Delta ${delta}, ATM` };
}

// Real Black-Scholes theoretical premium — replaces the old flat
// "intrinsic + spot*0.4%" guess, which ignored IV and time-to-expiry
// entirely (so it could be wildly off for high-VIX days or far expiries).
export function computeOptionPremium(spot: number, strike: number, iv: number, daysToExpiry: number, isCall: boolean): number {
  const { d1, d2, t } = d1d2(spot, strike, iv, daysToExpiry / 365);
  const r = 0.05;
  const discount = Math.exp(-r * t);
  const price = isCall
    ? spot * normCdf(d1) - strike * discount * normCdf(d2)
    : strike * discount * normCdf(-d2) - spot * normCdf(-d1);
  return Math.max(1, Number(price.toFixed(0)));
}

// Anchors stop-loss/targets to (a) the option's real delta and the
// underlying's VIX-implied expected move, and (b) real OI-based
// support/resistance walls when one falls within a sensible band —
// instead of arbitrary fixed percentages of the entry premium.
export function pickTradeLevels(opts: {
  spot: number; entry: number; delta: number; vix: number; daysToExpiry: number;
  isCall: boolean; support: { level: number }[]; resistance: { level: number }[];
}) {
  const { spot, entry, delta, vix, daysToExpiry, isCall, support, resistance } = opts;
  const T = Math.max(daysToExpiry, 0.5) / 365;
  // 1-standard-deviation expected move in underlying points over the
  // remaining life, from India VIX (annualized implied volatility).
  const sigma1 = spot * (vix / 100) * Math.sqrt(T);
  const absDelta = Math.max(0.15, Math.abs(delta));

  // Real OI walls in the direction that matters (resistance caps CE profit
  // potential above spot; support caps PE profit potential below spot).
  const levels = (isCall ? resistance : support).map(l => l.level).filter(lv => isCall ? lv > spot : lv < spot).sort((a, b) => isCall ? a - b : b - a);

  const premiumAtPoints = (pts: number) => Math.max(1, Number((entry + absDelta * pts).toFixed(0)));
  const fallback = [0.6, 1.0, 1.5].map(mult => premiumAtPoints(sigma1 * mult));

  // Use real OI levels where available (within ~2x the expected move, so we
  // don't anchor a "Target" thousands of points away at some stale wall);
  // fall back to the volatility-scaled estimate otherwise.
  const targets = [0, 1, 2].map(i => {
    const lvl = levels[i];
    if (lvl !== undefined && Math.abs(lvl - spot) <= sigma1 * 2.2) {
      return premiumAtPoints(Math.abs(lvl - spot));
    }
    return fallback[i];
  }).sort((a, b) => a - b);
  // Ensure targets are strictly increasing even if OI-level + fallback mix produced ties.
  for (let i = 1; i < targets.length; i++) if (targets[i] <= targets[i - 1]) targets[i] = targets[i - 1] + Math.max(1, Math.round(entry * 0.05));

  // Stop-loss: this dashboard's fastest signal is a 5-minute timeframe, so
  // a trade off it is only really valid over roughly that reaction window —
  // NOT the multi-day move used above for targets. The old SL reused the
  // same days-to-expiry-scaled sigma1 as the targets (half of it), which on
  // a 5-day expiry meant the stop was sized like a multi-day swing trade —
  // e.g. a ₹126 premium got a ₹26 stop (-79%), needing a huge underlying
  // swing to even trigger, long after the 5-min signal that justified the
  // trade would already be dead.
  // Instead, size the SL off the expected underlying move over one ~5-minute
  // bar (NSE session ≈ 375 trading minutes/day) — typically 15-25 Nifty
  // points on a normal-VIX day, which is what actually invalidates a
  // 5-min-timeframe signal, and still scales sensibly with VIX (wider on
  // volatile days, tighter on calm ones) instead of a hardcoded number.
  const TRADING_MINUTES_PER_DAY = 375;
  const REACTION_WINDOW_MIN = 5;
  const T_sl = REACTION_WINDOW_MIN / (TRADING_MINUTES_PER_DAY * 365);
  const slUnderlyingPoints = spot * (vix / 100) * Math.sqrt(T_sl);
  const sl = Math.max(1, Math.min(entry - 1, Number((entry - absDelta * slUnderlyingPoints).toFixed(0))));

  // Target 1 is a fixed 1:2 risk:reward off the real stop-loss — and this is
  // also the trade's actual auto-exit target (see the SL/Target auto-exit
  // effect in page.tsx), not just a reference level. Every trade that fires
  // is sized so its first, real exit point is exactly double the real risk
  // being taken (real risk = entry − the real SL above, not a round number),
  // regardless of where the nearest OI wall or volatility-scaled level
  // happens to sit. T2/T3 stay as informational "if you wanted to hold
  // longer" reference levels (OI-wall/volatility based, same as before),
  // just re-checked to stay strictly increasing past the new Target 1.
  const risk = Math.max(1, entry - sl);
  targets[0] = Math.max(entry + 1, Number((entry + 2 * risk).toFixed(0)));
  for (let i = 1; i < targets.length; i++) if (targets[i] <= targets[i - 1]) targets[i] = targets[i - 1] + Math.max(1, Math.round(entry * 0.05));

  const rr = Number(((targets[0] - entry) / risk).toFixed(2));
  return { stopLoss: sl, target1: targets[0], target2: targets[1], target3: targets[2], riskReward: rr };
}

// Rough, adjustable minimum — real safe liquidity varies a lot by index
// (Nifty ATM options routinely trade thousands of contracts; BankNifty and
// Sensex less so). This is a conservative baseline flag, not a precise
// exchange-defined cutoff — treat "Low Liquidity" as "check the spread
// yourself before trusting this fill," not a hard guarantee either way.
export const MIN_LIQUIDITY_VOLUME = 500;
export function isLowLiquidity(volume: number | undefined): boolean {
  return volume !== undefined && volume < MIN_LIQUIDITY_VOLUME;
}

// ----------------------------------------------------------------------------
// Real VWAP (volume-weighted average price) — NOT the same as "spot vs
// previous close". The dashboard badge was labeled "VWAP ABOVE/BELOW" but
// was actually computed from prev-day close, which isn't VWAP at all; it's
// a completely different (and much less informative) reference line. This
// computes the real thing: cumulative (typical price × volume) / cumulative
// volume, restricted to today's session candles only, exactly like a real
// trading terminal resets VWAP at the start of each session.
export function computeVWAP(candles: Candle[]): number | null {
  if (candles.length === 0) return null;
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const toISTDateKey = (ts: number) => new Date(ts + IST_OFFSET_MS).toISOString().slice(0, 10);
  const todayKey = toISTDateKey(candles[candles.length - 1].ts);
  const todaysCandles = candles.filter(c => toISTDateKey(c.ts) === todayKey);
  const session = todaysCandles.length > 0 ? todaysCandles : candles.slice(-75); // fallback: ~last session's worth of 5-min bars
  let cumPV = 0, cumV = 0;
  for (const c of session) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    const vol = c.volume > 0 ? c.volume : 1; // Yahoo occasionally reports 0 volume on an otherwise valid bar — treat as 1 so one bad bar doesn't zero out the whole VWAP
    cumPV += typicalPrice * vol;
    cumV += vol;
  }
  return cumV > 0 ? cumPV / cumV : null;
}

// ----------------------------------------------------------------------------
// Candlestick pattern detection — real OHLC math, not fabricated.
// ----------------------------------------------------------------------------
// Each rule below is a standard, well-defined technical-analysis definition
// (body/wick ratios), applied to real 5-min candles from Yahoo Finance.
// Deliberately limited to single/two-candle patterns with unambiguous math;
// multi-candle chart *formations* (head & shoulders, triangles, etc.) are
// left out — those rely on subjective peak/trough identification and are
// far more prone to false positives / overfitting than these are.
export interface CandlePattern { name: string; type: "bullish" | "bearish" | "neutral"; description: string; }

export function detectCandlePattern(candles: Candle[]): CandlePattern | null {
  if (candles.length < 2) return null;
  const c = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;
  if (range <= 0) return null;
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const isBullishCandle = c.close > c.open;

  // Doji: body is a tiny fraction of the whole candle's range — open and
  // close are almost equal, signaling indecision.
  if (body / range < 0.1) {
    return { name: "Doji", type: "neutral", description: "Open ≈ close — indecision, often precedes a reversal or pause." };
  }

  // Hammer: small body in the upper part of the range, a lower wick at
  // least 2x the body, and a small/no upper wick. Bullish when it appears
  // after a decline.
  if (lowerWick >= body * 2 && upperWick <= body * 0.5 && body / range < 0.4) {
    return { name: "Hammer", type: "bullish", description: "Small body, long lower wick — buyers rejected lower prices. Bullish, especially after a decline." };
  }

  // Shooting Star: mirror of the hammer — small body near the bottom,
  // long upper wick, little lower wick.
  if (upperWick >= body * 2 && lowerWick <= body * 0.5 && body / range < 0.4) {
    return { name: "Shooting Star", type: "bearish", description: "Small body, long upper wick — sellers rejected higher prices. Bearish, especially after a rally." };
  }

  // Bullish Engulfing: previous candle bearish, current candle bullish,
  // and the current body fully engulfs the previous body.
  const prevBearish = prev.close < prev.open;
  const prevBullish = prev.close > prev.open;
  if (prevBearish && isBullishCandle && c.open <= prev.close && c.close >= prev.open) {
    return { name: "Bullish Engulfing", type: "bullish", description: "This candle's body fully engulfs the prior (down) candle — a real shift in buying pressure." };
  }
  // Bearish Engulfing: mirror.
  if (prevBullish && !isBullishCandle && c.open >= prev.close && c.close <= prev.open) {
    return { name: "Bearish Engulfing", type: "bearish", description: "This candle's body fully engulfs the prior (up) candle — a real shift in selling pressure." };
  }

  return null;
}

// Solves for the implied volatility that would produce a given real market
// price, using bisection (computeOptionPremium is monotonically increasing
// in volatility, so this converges reliably). Used when a broker gives us
// real LTP but not IV directly (e.g. ICICI) — this derives genuine IV from
// real traded prices, instead of a constant placeholder that looks real but
// isn't.
export function impliedVolatility(spot: number, strike: number, daysToExpiry: number, marketPrice: number, isCall: boolean): number {
  if (marketPrice <= 0) return 13; // no real price to work from — last-resort placeholder
  let lo = 1, hi = 300;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const price = computeOptionPremium(spot, strike, mid, daysToExpiry, isCall);
    if (price > marketPrice) hi = mid; else lo = mid;
  }
  return Number(((lo + hi) / 2).toFixed(1));
}

function deriveSR(chain: OptionChainRow[], spot: number) {
  const b = chain.filter(r => r.strike < spot).sort((a, c) => c.strike - a.strike).slice(0, 3).map(r => ({ level: r.strike, strength: Math.round((r.peOi / 1000) * 10) / 10 })).sort((a, c) => c.strength - a.strength);
  const a = chain.filter(r => r.strike > spot).sort((a, c) => a.strike - c.strike).slice(0, 3).map(r => ({ level: r.strike, strength: Math.round((r.ceOi / 1000) * 10) / 10 })).sort((a, c) => c.strength - a.strength);
  return { support: b.slice(0, 2), resistance: a.slice(0, 2) };
}

export async function generateSnapshotYahoo(symbol: Symbol, expiryOverride?: string): Promise<OptionChainSnapshot> {
  const cacheKey = `${symbol}:${expiryOverride ?? "default"}`;
  const cached = cache[cacheKey]; if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;
  if (!yahooState[symbol]) yahooState[symbol] = initYahooState(symbol);
  const state = yahooState[symbol]!;
  const quote = await fetchYahooQuote(symbol);
  if (!quote) { throw new Error(`Live market data (Yahoo Finance) unavailable for ${symbol}. This is required for real spot price / VIX / technical signals — no fallback to simulated data is used.`); }
  state.spotPrev = state.closes.length > 0 ? state.closes[state.closes.length - 1] : quote.spot;
  state.closes = quote.closes.length > 0 ? quote.closes : [quote.spot]; state.vixPrev = quote.vix;
  const now = new Date();
  state.spotHistory.push({ t: now.toISOString(), v: quote.spot }); if (state.spotHistory.length > 30) state.spotHistory.shift();
  state.vixHistory.push({ t: now.toISOString(), v: quote.vix }); if (state.vixHistory.length > 30) state.vixHistory.shift();
  const st = quote.spot > quote.prevClose ? 0.03 : -0.03;
  state.pcr = Number(clamp(state.pcr + (1.0 - state.pcr) * 0.15 + st + (Math.random() - 0.5) * 0.015, 0.6, 1.5).toFixed(2));
  state.pcrHistory.push({ t: now.toISOString(), v: state.pcr }); if (state.pcrHistory.length > 30) state.pcrHistory.shift();
  const { totalCeOiChg, totalPeOiChg } = evolveChain(state, quote.spot);
  const smartFlow = Math.round((totalPeOiChg - totalCeOiChg) / 50);
  state.prevMaxPain = state.maxPain; state.maxPain = computeMaxPain(state.chain);
  let gex = 0; for (const row of state.chain) { const m = Math.abs(row.strike - quote.spot) / quote.spot; gex += 0.0025 * Math.exp(-m * 50) * (row.ceOi - row.peOi); }
  const gexM = Number((gex * quote.spot * 0.01).toFixed(1));
  const gammaFlip = state.maxPain + STRIKE_STEP[symbol] * Math.sign(gexM) * 2;
  const vwapValue = computeVWAP(quote.candles);
  const vw: "ABOVE" | "BELOW" | "AT" = vwapValue == null
    ? (quote.spot > quote.prevClose * 1.001 ? "ABOVE" : quote.spot < quote.prevClose * 0.999 ? "BELOW" : "AT") // fallback only if a session VWAP truly can't be computed (e.g. no candles yet)
    : quote.spot > vwapValue * 1.0005 ? "ABOVE" : quote.spot < vwapValue * 0.9995 ? "BELOW" : "AT";
  const of: "CALL WRITING" | "PUT WRITING" | "NEUTRAL" = smartFlow > 15 ? "PUT WRITING" : smartFlow < -15 ? "CALL WRITING" : "NEUTRAL";
  const ph = state.pcrHistory.slice(-6);
  const pt: "RISING" | "FALLING" | "FLAT" = ph.length >= 3 && ph[ph.length - 1].v > ph[0].v + 0.03 ? "RISING" : ph.length >= 3 && ph[ph.length - 1].v < ph[0].v - 0.03 ? "FALLING" : "FLAT";
  const pattern = detectCandlePattern(quote.candles);
  const s5 = computeTFS("5min", state.closes, state.pcr, vw, of, pt, pattern); const s15 = computeTFS("15min", state.closes, state.pcr, vw, of, pt); const s30 = computeTFS("30min", state.closes, state.pcr, vw, of, pt);
  // Regime/expiry/Bank-Nifty context needs to be known BEFORE the final
  // signal is locked in (and before it's pushed into signalHistory for
  // stability tracking) — moved these up from where they used to sit
  // further below so applyContextualAdjustments can run first.
  const rsi5 = s5.rsi; const ts = Math.round(clamp(50 + (rsi5 - 50) * 0.8 + smartFlow * 0.3, 5, 95)); const bp = Math.round(clamp(50 + (rsi5 - 50) * 0.7 + smartFlow * 0.2, 5, 95));
  const vs = quote.vix < 11 ? "LOW" : quote.vix < 16 ? "NORMAL" : quote.vix < 22 ? "HIGH" : "EXTREME";
  const bnc = ((quote.bankNifty - 57542.9) / 57542.9) * 100; const bns = Math.round(clamp(50 + bnc * 8, 5, 95));
  const bnt = bns > 75 ? "HIGH BULLISH" : bns > 60 ? "BULLISH" : bns > 40 ? "NEUTRAL" : bns > 25 ? "BEARISH" : "HIGH BEARISH";
  const regime: Regime = quote.vix > 18 ? "VOLATILE" : ts > 70 && smartFlow > 0 ? "TRENDING UP" : ts < 30 && smartFlow < 0 ? "TRENDING DOWN" : "RANGEBOUND";
  const { daysToExpiry, label: expStr } = getNextExpiry(symbol, expiryOverride);
  const step = STRIKE_STEP[symbol]; const atmStrike = Math.round(quote.spot / step) * step;
  const atmRow = state.chain.find(r => r.isATM) ?? state.chain[5];
  const osRaw = aggS([s5, s15, s30]);
  const os = applyContextualAdjustments(osRaw, regime, daysToExpiry, symbol, bnt, {
    priceUp: quote.spot > quote.prevClose, atmCeOiChg: atmRow.ceOiChg, atmPeOiChg: atmRow.peOiChg, lastCandle: quote.candles[quote.candles.length - 1],
  });
  state.signalHistory.push({ ts: Date.now(), action: os.signal, confidence: os.confidence }); if (state.signalHistory.length > 20) state.signalHistory.shift();
  const stability = computeSS(state.signalHistory);
  const greeks = computeGreeks(quote.spot, atmStrike, atmRow.ceIv, daysToExpiry);
  const sentiment: Sentiment = (() => { const sc = bp * 0.5 + ts * 0.3 + (smartFlow + 50) * 0.2; if (sc > 80) return "STRONG BULLISH"; if (sc > 60) return "BULLISH"; if (sc < 20) return "STRONG BEARISH"; if (sc < 40) return "BEARISH"; return "NEUTRAL"; })();
  const { support, resistance } = deriveSR(state.chain, quote.spot);
  const isCall = os.signal !== "BUY PE";
  // Trade entry uses an ITM strike (see pickEntryStrike above), not ATM —
  // higher delta means the same spot move produces a bigger premium gain.
  // atmRow/atmStrike above are kept as-is for the ATM Greeks display and
  // support/resistance context, which are still meant to reflect ATM.
  const entryStrike = pickEntryStrike(atmStrike, step, isCall);
  const entryRow = state.chain.find(r => r.strike === entryStrike) ?? atmRow;
  const iv = isCall ? entryRow.ceIv : entryRow.peIv;
  // Entry must be the real, actually-tradeable LTP, not the theoretical
  // Black-Scholes fair value — otherwise SL/Target/R:R are all computed
  // against a premium nobody could actually transact at. Theoretical price
  // is kept only as a fallback for a strike with no real traded price yet.
  const volumeAtStrike = isCall ? entryRow.ceVolume : entryRow.peVolume;
  const lowLiquidity = isLowLiquidity(volumeAtStrike);
  const ltpAtStrike = isCall ? entryRow.ceLtp : entryRow.peLtp;
  const theoreticalEntry = computeOptionPremium(quote.spot, entryStrike, iv, daysToExpiry, isCall);
  const usedRealLtp = ltpAtStrike !== undefined && ltpAtStrike > 0;
  const entry = usedRealLtp ? ltpAtStrike : theoreticalEntry;
  const entryDelta = computeGreeks(quote.spot, entryStrike, iv, daysToExpiry).delta;
  const { stopLoss: sl, target1: t1, target2: t2, target3: t3, riskReward: rr } = pickTradeLevels({
    spot: quote.spot, entry, delta: entryDelta, vix: quote.vix, daysToExpiry, isCall, support, resistance,
  });
  const rec: TradeRecommendation = { action: os.signal, strike: entryStrike, optionType: os.signal === "BUY PE" ? "PE" : "CE", entry, stopLoss: sl, target1: t1, target2: t2, target3: t3, confidence: os.confidence, riskReward: rr, volume: volumeAtStrike, lowLiquidity, ltp: ltpAtStrike, rationale: os.signal === "WAIT" ? `Mixed signals. Real spot ${quote.spot.toFixed(2)} vs prev close ${quote.prevClose.toFixed(2)} (${((quote.spot - quote.prevClose) / quote.prevClose * 100).toFixed(2)}%). VIX ${quote.vix.toFixed(2)}.` : `Real spot ${quote.spot.toFixed(2)} (${((quote.spot - quote.prevClose) / quote.prevClose * 100).toFixed(2)}% vs prev close). ${os.timeframe} consensus ${os.signal} at ${os.confidence}%. RSI(5m) ${s5.rsi.toFixed(0)}, EMA ${s5.emaCross}. Smart flow ${smartFlow > 0 ? "+" : ""}${smartFlow}. Strike ${entryStrike} (${ITM_STRIKES_FOR_ENTRY} ITM of ATM ${atmStrike}) for higher delta. IV ${iv}%, ${daysToExpiry}d to expiry. Entry ₹${entry} (${usedRealLtp ? "real LTP" : "theoretical fair value — no real LTP yet"}). R:R 1:${rr}.${lowLiquidity ? ` ⚠ Low volume (${volumeAtStrike ?? 0}) at this strike.` : ""}`, expiry: expStr };
  const smartSignal = computeSmartSignal({
    signals: { "5min": s5, "15min": s15, "30min": s30 },
    candidate: os.signal,
    pcr: state.pcr,
    smartFlow,
    gex: gexM,
    regime,
    vix: quote.vix,
    bankNiftyTrend: bnt,
    symbol,
    stability,
    painShift: state.maxPain - state.prevMaxPain,
    atmCeOiChg: atmRow.ceOiChg,
    atmPeOiChg: atmRow.peOiChg,
    sentiment,
  });
  const finalSignal = smartSignal.action === os.signal ? os : {
    ...os,
    signal: smartSignal.action,
    confidence: smartSignal.confidence,
    reasoning: [...os.reasoning, smartSignal.summary, ...smartSignal.blockers],
  };
  const snapshot: OptionChainSnapshot = {
    metrics: { symbol, spot: Number(quote.spot.toFixed(2)), prevSpot: Number(quote.prevClose.toFixed(2)), pcr: state.pcr, indiaVix: Number(quote.vix.toFixed(2)), vixStatus: vs, smartFlow, smartFlowAvailable: true, maxPain: state.maxPain, prevMaxPain: state.prevMaxPain, painShift: state.maxPain - state.prevMaxPain, gex: gexM, gammaFlip, trendScore: ts, bullProb: bp, bearProb: 100 - bp, bankNiftyScore: bns, bankNiftyTrend: bnt, support, resistance, regime, updatedAt: new Date().toISOString(), atmStrike },
    greeks, signals: { "5min": s5, "15min": s15, "30min": s30 }, overallSignal: finalSignal, recommendation: { ...rec, action: finalSignal.signal, confidence: finalSignal.confidence, rationale: `${rec.rationale} ${smartSignal.summary}` }, chain: state.chain.map(r => ({ ...r })), history: { spot: [...state.spotHistory], pcr: [...state.pcrHistory], vix: [...state.vixHistory] }, sentiment, signalStability: stability, candlePattern: pattern, smartSignal,
  };
  cache[cacheKey] = { ts: Date.now(), data: snapshot }; return snapshot;
}
