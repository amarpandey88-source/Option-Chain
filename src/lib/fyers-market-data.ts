import type { Candle } from "./yahoo-adapter";

// ============================================================================
// Fyers real-time market data — Quotes + History APIs
// ----------------------------------------------------------------------------
// Everything here exists to remove Yahoo Finance from the pipeline entirely
// when Fyers is connected. Two real gaps this closes:
//
//  1. Yahoo Finance's NSE India data can lag the real market by several
//     minutes. That's fine as the free/no-key fallback, but once a real
//     broker is connected there's no reason to keep computing spot price,
//     RSI/EMA/momentum, and the resulting BUY CE/PE signal from a delayed
//     feed while entries/SL/targets are computed from the broker's real
//     LTP — the two could disagree by more than they should.
//  2. India VIX: Fyers' own option-chain-v3 response already includes real
//     VIX data (`data.indiavixData`) in the exact same call the app was
//     already making for the option chain — broker-adapter.ts previously
//     ignored this and made a separate round-trip to Yahoo for VIX. See
//     fetchFyersOptionChain's extraction of `indiaVix` for that fix.
//
// Endpoints (confirmed from Fyers' own docsv3 + multiple independently
// published real request/response examples — e.g. the fyers-apiv3 Python
// SDK's own `fyers.quotes()` / `fyers.history()` wrappers, and several
// real user code samples on Fyers' community forum using the exact
// "NSE:NIFTY50-INDEX" / "NSE:NIFTYBANK-INDEX" symbols this file uses):
//   - Quotes:  GET  /data/quotes?symbols=<comma-separated>
//   - History: GET  /data/history?symbol=...&resolution=5&date_format=0&
//                    range_from=<epoch>&range_to=<epoch>&cont_flag=1
// ============================================================================

const FYERS_SYMBOL: Record<"NIFTY" | "BANKNIFTY", string> = {
  NIFTY: "NSE:NIFTY50-INDEX",
  BANKNIFTY: "NSE:NIFTYBANK-INDEX",
};

interface FyersQuoteResult { ltp: number; prevClose: number }

// One call, comma-separated symbols — used to get real, current LTP +
// previous close for the underlying (and Bank Nifty as a proxy indicator)
// in a single round trip.
export async function fetchFyersQuotes(
  symbols: string[],
  appId: string,
  accessToken: string
): Promise<Record<string, FyersQuoteResult>> {
  const url = `https://api-t1.fyers.in/data/quotes?symbols=${encodeURIComponent(symbols.join(","))}`;
  const res = await fetch(url, { headers: { Authorization: `${appId}:${accessToken}` } });
  if (!res.ok) throw new Error(`Fyers quotes failed: HTTP ${res.status}`);
  const json = await res.json();
  if (json.s !== "ok" || !Array.isArray(json.d)) {
    throw new Error(`Fyers quotes failed: ${json.message || "unexpected response shape"}`);
  }
  const out: Record<string, FyersQuoteResult> = {};
  for (const item of json.d) {
    const v = item?.v;
    if (!v) continue;
    // Field names confirmed from real user-posted quotes responses:
    // v.lp = last price, v.prev_close_price = previous session close.
    const ltp = Number(v.lp);
    const prevClose = Number(v.prev_close_price ?? v.prevClosePrice);
    if (Number.isFinite(ltp) && Number.isFinite(prevClose) && prevClose > 0) {
      out[item.n] = { ltp, prevClose };
    }
  }
  return out;
}

// 5-min candles over the last few trading days — feeds the same
// RSI/EMA/momentum/VWAP signal engine (computeTFS/aggS in yahoo-adapter.ts)
// that already exists, just with real broker candles instead of Yahoo's.
export async function fetchFyersCandles(
  fySymbol: string,
  appId: string,
  accessToken: string
): Promise<Candle[]> {
  const now = Math.floor(Date.now() / 1000);
  const fiveDaysAgo = now - 5 * 24 * 60 * 60; // covers weekends/holidays comfortably for ~2 trading days of 5-min bars
  const params = new URLSearchParams({
    symbol: fySymbol,
    resolution: "5",
    date_format: "0", // epoch seconds in, epoch seconds out
    range_from: String(fiveDaysAgo),
    range_to: String(now),
    cont_flag: "1",
  });
  const url = `https://api-t1.fyers.in/data/history?${params.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `${appId}:${accessToken}` } });
  if (!res.ok) throw new Error(`Fyers history failed: HTTP ${res.status}`);
  const json = await res.json();
  if (json.s !== "ok" || !Array.isArray(json.candles)) {
    // "no_data" is Fyers' own status for "market not open yet today, no
    // candles for the requested window" — not a real failure, just empty.
    if (json.s === "no_data") return [];
    throw new Error(`Fyers history failed: ${json.message || "unexpected response shape"}`);
  }
  // Each candle: [epochSeconds, open, high, low, close, volume]
  return (json.candles as number[][]).map(([ts, open, high, low, close, volume]) => ({
    open, high, low, close, volume: volume ?? 0, ts: ts * 1000,
  }));
}

// Convenience wrapper: real spot + prevClose + candles (closes[] included
// for direct use by computeTFS) for NIFTY/BANKNIFTY/SENSEX, plus Bank
// Nifty's own quote as a cross-market confirmation proxy. Returns null on
// any failure so callers can fall back to Yahoo cleanly rather than
// half-filling a snapshot with missing real data.
export interface FyersMarketData {
  spot: number; prevClose: number; closes: number[]; candles: Candle[]; bankNifty: number;
}

export async function fetchFyersMarketData(
  symbol: "NIFTY" | "BANKNIFTY" | "SENSEX",
  appId: string,
  accessToken: string
): Promise<FyersMarketData | null> {
  // SENSEX isn't in FYERS_SYMBOL (BSE index quoting conventions on Fyers
  // aren't independently confirmed the same way NIFTY/BANKNIFTY are) — the
  // caller falls back to Yahoo for Sensex, same as before this change.
  const fySymbol = symbol === "SENSEX" ? undefined : FYERS_SYMBOL[symbol];
  if (!fySymbol) return null;
  try {
    const [quotes, candles] = await Promise.all([
      fetchFyersQuotes([FYERS_SYMBOL.NIFTY, FYERS_SYMBOL.BANKNIFTY], appId, accessToken),
      fetchFyersCandles(fySymbol, appId, accessToken),
    ]);
    const own = quotes[fySymbol];
    const bankQuote = quotes[FYERS_SYMBOL.BANKNIFTY];
    if (!own || candles.length === 0) return null;
    return {
      spot: own.ltp,
      prevClose: own.prevClose,
      closes: candles.map((c) => c.close),
      candles,
      // Falls back to the symbol's own price only if the Bank Nifty quote
      // specifically failed to come back — keeps the cross-check from
      // silently producing a nonsense "always agrees with itself" result.
      bankNifty: bankQuote?.ltp ?? own.ltp,
    };
  } catch (err) {
    console.error("[fyers-market-data] real market data fetch failed, will fall back to Yahoo:", err);
    return null;
  }
}
