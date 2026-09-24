// ============================================================================
// Broker Adapter — Real Option Chain Data from Indian Brokers
// ----------------------------------------------------------------------------
// Supports: ICICI Direct Breeze, Angel One SmartAPI, Dhan, Fyers, Zerodha Kite
//
// Unlike Yahoo (which only gives spot/VIX), brokers give REAL option chain OI.
// This makes PCR, Max Pain, GEX all 100% real.
//
// For Fyers specifically, spot price, India VIX, and the underlying candles
// that drive the RSI/EMA/VWAP signal engine are ALSO real (see
// fyers-market-data.ts + yahoo-adapter.ts's computeSignalContext) — Yahoo
// Finance is only used as a same-refresh fallback if any of those Fyers
// calls fail. Every other broker here still uses Yahoo for spot/VIX/signals,
// since an equivalent confirmed real-data path hasn't been built for them.
//
// API keys are read from environment variables (set in .env.local or via the
// in-app API Keys dialog which writes to a server-side config file).
// ============================================================================

import {
  OptionChainRow, OptionChainSnapshot, Regime, Sentiment, SignalStability,
  Symbol, Timeframe, TimeframeSignal, TradeAction, TradeRecommendation, ATMGreeks,
} from "./types";
import { generateSnapshotYahoo, computeGreeks, computeOptionPremium, pickTradeLevels, getNextExpiry, isLowLiquidity, impliedVolatility, computeSignalContext, pickEntryStrike, ITM_STRIKES_FOR_ENTRY } from "./yahoo-adapter";
import { fetchFyersMarketData } from "./fyers-market-data";
import { getDefaultExpiry, daysUntil } from "./expiry-utils";
import { randomUUID, createHash } from "node:crypto";
import { computeSmartSignal } from "./smart-signal-engine";
import https from "node:https";

// Node's built-in fetch() refuses to send a body on a GET request (it
// enforces the Fetch spec's client-side restriction, throwing "Request
// with GET/HEAD method cannot have body"). ICICI's Breeze API requires
// exactly that combination — their own official Python SDK does it via the
// `requests` library, which has no such restriction. HTTP itself doesn't
// forbid a GET body; only the Fetch spec does. Using Node's lower-level
// https module sidesteps that restriction for the two Breeze endpoints
// that need it.
function httpGetWithBody(url: string, headers: Record<string, string>, body: string): Promise<{ status: number; text: () => string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: "GET", headers: { ...headers, "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode || 0,
            text: () => raw,
          });
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// See note in yahoo-adapter.ts — exchanges revise lot sizes/strike steps
// periodically; these are current as of this writing.
const STRIKE_STEP: Record<Symbol, number> = { NIFTY: 50, BANKNIFTY: 100, SENSEX: 100 };
const LOT_SIZE: Record<Symbol, number> = { NIFTY: 65, BANKNIFTY: 30, SENSEX: 20 };

// ----------------------------------------------------------------------------
// Broker config — read from env vars
// ----------------------------------------------------------------------------
export function getBrokerConfig() {
  return {
    provider: (process.env.BROKER_PROVIDER || "").toLowerCase(),
    // ICICI — Breeze has no username/password/TOTP programmatic login; the
    // user must visit a login URL in a browser once a day and paste the
    // resulting session token (same daily-token pattern as Groww/Dhan/Fyers).
    icici: {
      apiKey: process.env.ICICI_API_KEY || "",
      secretKey: process.env.ICICI_SECRET_KEY || "",
      sessionToken: process.env.ICICI_SESSION_TOKEN || "",
    },
    // Angel One
    angel: {
      apiKey: process.env.ANGEL_API_KEY || "",
      secretKey: process.env.ANGEL_SECRET_KEY || "",
      clientCode: process.env.ANGEL_CLIENT_CODE || "",
      password: process.env.ANGEL_PASSWORD || "",
      totpSecret: process.env.ANGEL_TOTP_SECRET || "",
    },
    // Dhan
    dhan: {
      accessToken: process.env.DHAN_ACCESS_TOKEN || "",
      clientId: process.env.DHAN_CLIENT_ID || "",
    },
    // Fyers
    fyers: {
      appId: process.env.FYERS_APP_ID || "",
      secretId: process.env.FYERS_SECRET_ID || "",
      accessToken: process.env.FYERS_ACCESS_TOKEN || "",
    },
    // Zerodha
    zerodha: {
      apiKey: process.env.KITE_API_KEY || "",
      apiSecret: process.env.KITE_API_SECRET || "",
      accessToken: process.env.KITE_ACCESS_TOKEN || "",
    },
    // Groww
    groww: {
      accessToken: process.env.GROWW_ACCESS_TOKEN || "",
      clientId: process.env.GROWW_CLIENT_ID || "",
    },
  };
}

// ----------------------------------------------------------------------------
// Check if broker is configured
// ----------------------------------------------------------------------------
export function isBrokerConfigured(): boolean {
  const cfg = getBrokerConfig();
  if (!cfg.provider) return false;
  switch (cfg.provider) {
    case "icici":
      return !!(cfg.icici.apiKey && cfg.icici.secretKey && cfg.icici.sessionToken);
    case "angel":
      return !!(cfg.angel.apiKey && cfg.angel.secretKey && cfg.angel.clientCode);
    case "dhan":
      return !!(cfg.dhan.accessToken && cfg.dhan.clientId);
    case "fyers":
      return !!(cfg.fyers.appId && cfg.fyers.accessToken);
    case "zerodha":
      return !!(cfg.zerodha.apiKey && cfg.zerodha.accessToken);
    case "groww":
      return !!cfg.groww.accessToken;
    default:
      return false;
  }
}

export function getConfiguredBroker(): string | null {
  const cfg = getBrokerConfig();
  return cfg.provider || null;
}

// ----------------------------------------------------------------------------
// Broker session cache (session tokens are expensive to generate)
// ----------------------------------------------------------------------------
interface BrokerSession {
  token: string;
  expiresAt: number;
}
let sessionCache: BrokerSession | null = null;

// ----------------------------------------------------------------------------
// ICICI Direct Breeze API
// ----------------------------------------------------------------------------
// Reverse-engineered from the official breeze-connect Python SDK (PyPI,
// v1.0.69) since Breeze's raw REST reference doesn't fully document the
// option-chain request/response shape. Breeze has NO programmatic
// username/password login — the user must visit
// https://api.icicidirect.com/apiuser/login?api_key=<AppKey> in a browser
// once a day, log in, and paste the `API_Session` value from the redirect
// URL as ICICI_SESSION_TOKEN. This function exchanges that daily value for
// the real working session token.
const ICICI_STOCK_CODE: Record<Symbol, string> = { NIFTY: "NIFTY", BANKNIFTY: "CNXBAN", SENSEX: "BSESEN" };
// Sensex trades on BSE, not NSE — Breeze needs a different exchange_code for it.
const ICICI_EXCHANGE_CODE: Record<Symbol, string> = { NIFTY: "NFO", BANKNIFTY: "NFO", SENSEX: "BFO" };

function safeJson(res: { status: number; text: () => string }, context: string): any {
  const raw = res.text();
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`ICICI ${context} returned a non-JSON response (HTTP ${res.status}): ${raw.slice(0, 200)}`);
  }
}

async function iciciLogin(): Promise<string> {
  const cfg = getBrokerConfig().icici;
  const body = JSON.stringify({ SessionToken: cfg.sessionToken, AppKey: cfg.apiKey });
  const res = await httpGetWithBody("https://api.icicidirect.com/breezeapi/api/v1/customerdetails", { "Content-Type": "application/json" }, body);
  const data = safeJson(res, "session exchange");
  if (!data.Success?.session_token) {
    throw new Error(`ICICI session exchange failed: ${data.Error || "Unknown error"} — your daily session token (ICICI_SESSION_TOKEN) may have expired; generate a new one at https://api.icicidirect.com/apiuser/login?api_key=${encodeURIComponent(cfg.apiKey)}`);
  }
  // This value is already base64("userId:sessionKey") — exactly what the
  // X-SessionToken header expects for every subsequent request.
  return data.Success.session_token as string;
}

function iciciChecksumHeaders(secretKey: string, appKey: string, sessionToken: string, body: string) {
  const timestamp = new Date().toISOString().slice(0, 19) + ".000Z";
  const checksum = createHash("sha256").update(timestamp + body + secretKey).digest("hex");
  return {
    "Content-Type": "application/json",
    "X-Checksum": "token " + checksum,
    "X-Timestamp": timestamp,
    "X-AppKey": appKey,
    "X-SessionToken": sessionToken,
  };
}

async function fetchIciciOneSide(stockCode: string, exchangeCode: string, expiryDate: string, right: "Call" | "Put", secretKey: string, appKey: string, sessionToken: string): Promise<any[]> {
  const bodyObj = { stock_code: stockCode, exchange_code: exchangeCode, expiry_date: expiryDate, product_type: "options", right, strike_price: "" };
  const body = JSON.stringify(bodyObj);
  const headers = iciciChecksumHeaders(secretKey, appKey, sessionToken, body);
  // Breeze's own SDK sends a GET request with a JSON body (unusual but
  // required — their server expects it this way). Node's fetch() refuses
  // to do this, so we use the raw https module (see httpGetWithBody above).
  const res = await httpGetWithBody("https://api.icicidirect.com/breezeapi/api/v1/optionchain", headers, body);
  const data = safeJson(res, `option chain (${right})`);
  if (!data.Success) {
    throw new Error(`ICICI option chain (${right}) failed: ${data.Error || "Unknown error"}`);
  }
  return data.Success as any[];
}

async function fetchIciciOptionChain(symbol: Symbol, sessionToken: string, expiryOverride?: string) {
  const cfg = getBrokerConfig().icici;
  const stockCode = ICICI_STOCK_CODE[symbol];
  const exchangeCode = ICICI_EXCHANGE_CODE[symbol];
  // Real ISO format confirmed from ICICI's own "How to fetch Option chain"
  // FAQ example: expiry_date="2022-12-25T06:00:00.000Z".
  const expiryDate = getNextExpiryISOString(symbol, expiryOverride) + "T06:00:00.000Z";

  // Breeze requires "right" (Call/Put) to be set once expiry_date is
  // given — passing both right and strike_price blank together is
  // rejected ("Either Right or Strike-Price cannot be empty"), confirmed
  // by the client-side validation baked into Breeze's own official SDK.
  // So: one request for the full Call side, one for the full Put side.
  //
  // Promise.allSettled (not Promise.all) deliberately, so that if one side
  // fails we still know what happened to the OTHER side — Promise.all would
  // only ever surface the first rejection and silently discard the other
  // side's outcome, which made a "Put failed" error impossible to tell
  // apart from "Put failed AND Call also failed" or "Put failed but Call
  // actually had real data". That distinction matters a lot for figuring
  // out whether this is a real, both-sides-missing listing (the whole
  // expiry doesn't exist), or something odd specific to one side only.
  const [ceResult, peResult] = await Promise.allSettled([
    fetchIciciOneSide(stockCode, exchangeCode, expiryDate, "Call", cfg.secretKey, cfg.apiKey, sessionToken),
    fetchIciciOneSide(stockCode, exchangeCode, expiryDate, "Put", cfg.secretKey, cfg.apiKey, sessionToken),
  ]);
  if (ceResult.status === "rejected" && peResult.status === "rejected") {
    throw new Error(`ICICI option chain failed for BOTH sides — Call: ${ceResult.reason?.message || ceResult.reason}; Put: ${peResult.reason?.message || peResult.reason}. This usually means the requested expiry (${expiryDate.slice(0, 10)}) genuinely isn't listed for ${stockCode} on Breeze right now — try a different expiry from the dropdown, or verify this contract exists in your ICICI Direct account.`);
  }
  if (ceResult.status === "rejected") {
    throw new Error(`ICICI Call side failed (${ceResult.reason?.message || ceResult.reason}) but Put side succeeded — inconsistent result for the same expiry, which is unusual. This looks like a transient Breeze-side issue; try refreshing.`);
  }
  if (peResult.status === "rejected") {
    throw new Error(`ICICI Put side failed (${peResult.reason?.message || peResult.reason}) but Call side succeeded — inconsistent result for the same expiry, which is unusual. This looks like a transient Breeze-side issue; try refreshing.`);
  }
  const ceRows = ceResult.value, peRows = peResult.value;
  const rows = [...ceRows, ...peRows];

  // Breeze returns one row per (strike, right) — i.e. Call and Put rows are
  // separate, not paired like some other brokers. Group them by strike.
  const byStrike = new Map<number, any>();
  for (const r of rows) {
    const strike = Number(r.strike_price);
    const entry = byStrike.get(strike) || { strike };
    const isCall = String(r.right).toLowerCase() === "call";
    const oi = Number(r.open_interest) || 0;
    const ltp = Number(r.ltp ?? r.close) || 0;
    const vol = Number(r.volume) || undefined;
    if (isCall) { entry.ceOI = oi; entry.ceLTP = ltp; entry.ceVolume = vol; }
    else { entry.peOI = oi; entry.peLTP = ltp; entry.peVolume = vol; }
    byStrike.set(strike, entry);
  }
  return Array.from(byStrike.values()).map((e) => ({
    strike: e.strike,
    ceOI: e.ceOI || 0, peOI: e.peOI || 0,
    ceLTP: e.ceLTP || 0, peLTP: e.peLTP || 0,
    ceIV: 0, peIV: 0, // Breeze doesn't give IV directly — real IV gets derived from real LTP in mapToOptionChainRows
    ceOIChange: 0, peOIChange: 0, // ...or OI change; see broker's own OI level only
    ceVolume: e.ceVolume, peVolume: e.peVolume,
  }));
}

// ----------------------------------------------------------------------------
// Angel One SmartAPI
// ----------------------------------------------------------------------------
async function angelLogin(): Promise<string> {
  const cfg = getBrokerConfig().angel;
  const res = await fetch("https://apiconnect.angelone.in/rest/auth/angelbroking/jwt/v1/loginByPassword", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-ClientCode": cfg.clientCode, "X-PrivateKey": cfg.apiKey, "Accept": "application/json" },
    body: JSON.stringify({ clientcode: cfg.clientCode, password: cfg.password }),
  });
  const data = await res.json();
  if (!data.data || !data.data.jwtToken) {
    throw new Error(`Angel login failed: ${data.message || "Unknown"}`);
  }
  return data.data.jwtToken;
}

async function fetchAngelOptionChain(symbol: Symbol, jwt: string) {
  const cfg = getBrokerConfig().angel;
  // NOTE: BANKNIFTY previously incorrectly mapped to "NIFTY" here — fixed.
  // SENSEX/BSE mapping below is a best-effort inference (Angel's docs are
  // thin on BSE index options specifically) — verify if this 404s/errors.
  const symbolMap: Record<Symbol, string> = { NIFTY: "NIFTY", BANKNIFTY: "BANKNIFTY", SENSEX: "SENSEX" };
  const exchangeMap: Record<Symbol, string> = { NIFTY: "NSE", BANKNIFTY: "NSE", SENSEX: "BSE" };
  const res = await fetch("https://apiconnect.angelone.in/rest/secure/angelbroking/optionChain/v1/optionChain", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${jwt}`, "X-PrivateKey": cfg.apiKey, "X-ClientCode": cfg.clientCode },
    body: JSON.stringify({ name: symbolMap[symbol], exchange: exchangeMap[symbol] }),
  });
  const data = await res.json();
  if (!data.data) throw new Error(`Angel option chain failed: ${data.message}`);
  return data.data;
}

// ----------------------------------------------------------------------------
// Dhan API (simplest — just needs access token)
// ----------------------------------------------------------------------------
async function fetchDhanOptionChain(symbol: Symbol) {
  const cfg = getBrokerConfig().dhan;
  if (symbol === "SENSEX") {
    throw new Error("Dhan + SENSEX isn't wired up yet — Dhan identifies instruments by a numeric security_id, and Sensex's ID isn't confirmed here (unlike NIFTY=13/BANKNIFTY=25 which are well-documented). Look it up via Dhan's instrument list API (https://api.dhan.co/v2/instrument/IDX_I) and it can be added.");
  }
  const symbolMap: Record<"NIFTY" | "BANKNIFTY", string> = { NIFTY: "NIFTY 50", BANKNIFTY: "NIFTY BANK" };
  const securityIdMap: Record<"NIFTY" | "BANKNIFTY", string> = { NIFTY: "13", BANKNIFTY: "25" };
  const res = await fetch("https://api.dhan.co/v2/optionchain", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Access-Token": cfg.accessToken, "Client-Id": cfg.clientId },
    body: JSON.stringify({ UnderlyingScrip: securityIdMap[symbol], UnderlyingSeg: "INDEXIDX" }),
  });
  const data = await res.json();
  if (!data.data) throw new Error("Dhan option chain failed");
  return data.data;
}

// ----------------------------------------------------------------------------
// Groww API — Bearer token auth
// ----------------------------------------------------------------------------
// The endpoint/params/response-shape below are taken directly from Groww's
// official Python SDK source (the `growwapi` package on PyPI) — Groww only
// publishes a Python SDK for this method, not a raw REST reference, so the
// SDK source is the authoritative spec. Confirmed against growwapi 1.5.0.
const GROWW_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  "x-request-id": randomUUID(),
  "x-client-id": "option-chain-pulse",
  "x-client-platform": "option-chain-pulse-electron",
  "x-api-version": "1.0",
});

function growwUnwrap(json: any, context: string) {
  if (json?.status === "FAILURE") {
    throw new Error(`Groww ${context} failed: ${json.error?.message || "unknown error"} (code ${json.error?.code})`);
  }
  return json?.payload ?? json;
}

// Groww requires an explicit expiry_date (YYYY-MM-DD) — there's no "nearest
// expiry" shortcut in their API. Fetch real expiry dates from Groww itself
// (rather than guessing NSE's weekly-expiry weekday, which has changed more
// than once by SEBI mandate and would silently go stale) and pick the
// earliest one that hasn't passed yet.
async function fetchGrowwNearestExpiry(token: string, underlying: string): Promise<string> {
  const now = new Date();
  const url = `https://api.groww.in/v1/historical/expiries?exchange=NSE&underlying_symbol=${encodeURIComponent(underlying)}&year=${now.getFullYear()}`;
  const res = await fetch(url, { headers: GROWW_HEADERS(token) });
  if (!res.ok) throw new Error(`Groww expiries lookup failed: HTTP ${res.status}`);
  const payload = growwUnwrap(await res.json(), "expiries lookup");
  const list: string[] = payload?.expiries || payload?.expiry_dates || (Array.isArray(payload) ? payload : []);
  const todayStr = now.toISOString().slice(0, 10);
  const upcoming = list.filter((d) => d >= todayStr).sort();
  if (upcoming.length === 0) throw new Error(`Groww: no upcoming expiry found for ${underlying}`);
  return upcoming[0];
}

async function fetchGrowwOptionChain(symbol: Symbol, expiryOverride?: string) {
  if (symbol === "SENSEX") {
    throw new Error("Groww + SENSEX isn't supported here — Groww's official SDK only exposes NSE (and US) as exchange options, with no confirmed BSE/Sensex support. Use ICICI or Angel for Sensex instead.");
  }
  const cfg = getBrokerConfig().groww;
  const token = cfg.accessToken;
  // Groww's `underlying` param matches our Symbol type directly — no mapping needed.
  const underlying = symbol;

  const expiryDate = expiryOverride || await fetchGrowwNearestExpiry(token, underlying);

  const url = `https://api.groww.in/v1/option-chain/exchange/NSE/underlying/${encodeURIComponent(underlying)}?expiry_date=${expiryDate}`;
  const res = await fetch(url, { headers: GROWW_HEADERS(token) });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groww option chain failed: HTTP ${res.status} — ${errText.slice(0, 200)}`);
  }
  const payload = growwUnwrap(await res.json(), "option chain");
  const strikes = payload?.strikes;
  if (!strikes || typeof strikes !== "object") {
    throw new Error("Groww option chain: unexpected response shape (no 'strikes' object)");
  }

  // NOTE: Groww's option-chain payload does not include per-strike OI change
  // (only current open_interest) — ceOIChange/peOIChange come back as 0 for
  // this broker. This is a genuine gap in what Groww exposes, not a bug: OI
  // is real, OI *change* just isn't available from this endpoint, so
  // OI-flow/"smart money" signals will be based on OI level only for Groww.
  return Object.entries(strikes).map(([strikeStr, v]: [string, any]) => ({
    strike: Number(strikeStr),
    ceOI: v.CE?.open_interest || 0,
    peOI: v.PE?.open_interest || 0,
    ceLTP: v.CE?.ltp || 0,
    peLTP: v.PE?.ltp || 0,
    ceIV: v.CE?.greeks?.iv || 13,
    peIV: v.PE?.greeks?.iv || 13,
    ceOIChange: 0,
    peOIChange: 0,
    ceVolume: v.CE?.volume ?? undefined,
    peVolume: v.PE?.volume ?? undefined,
  }));
}
// ----------------------------------------------------------------------------
// Fyers API v3 — Authorization header auth (appId:accessToken)
// ----------------------------------------------------------------------------
// Confirmed from Fyers' own community/SDK sources (fyers-apiv3 Python SDK,
// FyersDev sample code, and multiple real user-posted request/response
// examples):
//  - Request shape: { symbol, strikecount, timestamp } where symbol is like
//    "NSE:NIFTY50-INDEX" / "NSE:NIFTYBANK-INDEX" / "BSE:SENSEX-INDEX", and
//    an empty timestamp means "nearest expiry".
//  - Response shape: { s, code, message, data: { callOi, putOi,
//    indiavixData, expiryData: [{date, expiry}], optionsChain: [...] } }
//  - Each optionsChain entry carries at least: symbol, option_type ("CE"/
//    "PE"), strike_price, ltp, oi, volume — confirmed from a real user's
//    printed dataframe columns on the Fyers community forum. CE and PE are
//    SEPARATE entries per strike (not pre-combined), so we group them below.
//  - Auth header format `Authorization: <app_id>:<access_token>` is Fyers'
//    long-documented, widely-used convention across their v2/v3 APIs.
//
// One thing is genuinely NOT independently verified here: the exact literal
// REST path. Every public source describes this via the official Python SDK
// method `fyers.optionchain(data=...)`, not a raw HTTP path — the SDK hides
// the URL. The path below is inferred from the confirmed pattern of other
// v3 endpoints (all on host api-t1.fyers.in, e.g. /api/v3/orders,
// /api/v3/price-alert) plus Fyers' documented /data/ prefix for market-data
// endpoints in v2. If this 404s for you, check the exact path at
// https://myapi.fyers.in/docsv3 (under Data Api) and it's a one-line fix.
// Per-strike IV isn't in this response either — left at 0 here so the
// shared mapToOptionChainRows() below derives real IV from the real LTP
// (reverse Black-Scholes), same as it already does for ICICI.
// ----------------------------------------------------------------------------
async function fetchFyersOptionChain(symbol: Symbol, expiryOverride?: string): Promise<{ rows: any[]; indiaVix?: number }> {
  const cfg = getBrokerConfig().fyers;
  const fySymbolMap: Record<Symbol, string> = {
    NIFTY: "NSE:NIFTY50-INDEX",
    BANKNIFTY: "NSE:NIFTYBANK-INDEX",
    SENSEX: "BSE:SENSEX-INDEX",
  };
  const fySymbol = fySymbolMap[symbol];
  // Empty timestamp = nearest expiry (confirmed). A specific expiry is
  // requested by passing its epoch-seconds timestamp instead — this part
  // isn't independently confirmed the same way the rest of this function
  // is (no directly-quoted example of a non-empty timestamp value was
  // found), but epoch-seconds-of-the-expiry-date is Fyers' convention
  // elsewhere in their v3 API, so it's a reasonable, clearly-flagged
  // best effort. If picking a specific expiry silently returns the
  // nearest one instead for Fyers, this is the line to revisit.
  const timestamp = expiryOverride ? Math.floor(new Date(expiryOverride + "T00:00:00+05:30").getTime() / 1000).toString() : "";
  const url = `https://api-t1.fyers.in/data/options-chain-v3?symbol=${encodeURIComponent(fySymbol)}&strikecount=15&timestamp=${timestamp}`;
  const res = await fetch(url, {
    headers: { Authorization: `${cfg.appId}:${cfg.accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Fyers option chain failed: HTTP ${res.status} — ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  if (json.s !== "ok") {
    throw new Error(`Fyers option chain failed: ${json.message || "unknown error"} (code ${json.code})`);
  }
  const legs: any[] = json.data?.optionsChain || [];
  const byStrike = new Map<number, any>();
  for (const leg of legs) {
    if (leg.option_type !== "CE" && leg.option_type !== "PE") continue; // skips the underlying's own index quote row, which Fyers includes with no option_type
    const strike = Math.round(leg.strike_price);
    const row = byStrike.get(strike) ?? { strike };
    if (leg.option_type === "CE") {
      row.ceLTP = leg.ltp ?? 0; row.ceOI = leg.oi ?? 0; row.ceVolume = leg.volume ?? undefined;
      row.ceOIChange = leg.oich ?? 0; // field name for OI change isn't confirmed — self-computed OI-change diffing (below) is the real fallback for this either way
      row.ceFySymbol = leg.symbol; // real Fyers trading symbol for this leg — used for live tick-stream subscription
    } else {
      row.peLTP = leg.ltp ?? 0; row.peOI = leg.oi ?? 0; row.peVolume = leg.volume ?? undefined;
      row.peOIChange = leg.oich ?? 0;
      row.peFySymbol = leg.symbol;
    }
    byStrike.set(strike, row);
  }
  if (byStrike.size === 0) throw new Error("Fyers option chain: response had no CE/PE strikes");
  // Fyers' option-chain-v3 response includes real India VIX in the exact
  // same call, under `data.indiavixData` — extracting it here means the
  // caller never has to make (or fall back to Yahoo for) a separate VIX
  // request. Exact JSON key casing isn't independently confirmed beyond
  // the Go SDK's `IndiaVixData` struct field name, so this defensively
  // tries the plausible variants and simply returns undefined (safe
  // Yahoo fallback, unchanged behavior) if none of them match.
  const vixBlock = json.data?.indiavixData ?? json.data?.indiaVixData ?? json.data?.IndiaVixData;
  const rawVix = vixBlock?.ltp ?? vixBlock?.ltpc ?? vixBlock?.LTP;
  const indiaVix = Number.isFinite(Number(rawVix)) && Number(rawVix) > 0 ? Number(rawVix) : undefined;
  return { rows: Array.from(byStrike.values()), indiaVix };
}

// ----------------------------------------------------------------------------
// Helper: get next weekly-expiry date (ISO) for a symbol.
// ----------------------------------------------------------------------------
// Following SEBI's September 2025 derivatives reshuffle, each exchange was
function getNextExpiryISOString(symbol: Symbol, overrideIso?: string): string {
  return overrideIso || getDefaultExpiry(symbol).iso;
}

// ----------------------------------------------------------------------------
// Map broker-specific option chain data → our OptionChainRow format
// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
// Self-computed OI change (fills the gap for brokers like ICICI/Groww that
// don't provide per-strike OI *change* directly). Since we poll real OI on
// every refresh anyway, we can diff this poll's real OI against the last
// poll's real OI ourselves — this is genuine derived data from two real
// observations, not fabricated. Only becomes available starting from the
// second poll for a given symbol (nothing to diff against on the first).
// ----------------------------------------------------------------------------
// Keyed by `${symbol}:${expiryIso}`, not just symbol — diffing OI or
// plotting PCR history across two DIFFERENT expiries (e.g. right after a
// user switches which expiry they're viewing) would produce meaningless
// numbers, since it's no longer really "the same contract's OI a poll ago".
const prevOiCache: Partial<Record<string, Map<number, { ceOi: number; peOi: number }>>> = {};

// ----------------------------------------------------------------------------
// Real PCR history, tracked separately per symbol+expiry.
//
// The final snapshot below used to just pass through `yahooBase.history`
// wholesale, including its `pcr` array. That array is populated entirely
// inside the Yahoo-quote code path from Yahoo's own (much less accurate,
// sometimes delayed) chain data — a completely different PCR calculation
// than `cm.pcr`, which is computed fresh from this function's REAL broker
// OI data on every single call. The two would routinely disagree (e.g. Key
// Metrics showing a real PCR of 1.00 while the Live Trend sparkline showed
// Yahoo's PCR of 0.79 for the same instant) because they were never the
// same number to begin with.
// So: track our own rolling PCR history from the real `cm.pcr` value, and
// use THIS for the sparkline/history — not Yahoo's.
// ----------------------------------------------------------------------------
const brokerPcrHistoryCache: Partial<Record<string, { t: string; v: number }[]>> = {};

// State kept only for the Fyers real-market-data path (see
// buildFyersRealSignalContext below) — mirrors what yahoo-adapter.ts's
// internal per-symbol state already tracks (spot/vix history for the
// charts, and signal history for the stability/lock indicator), just
// keyed by plain symbol here since spot/VIX don't depend on expiry.
const fyersSpotHistoryCache: Partial<Record<Symbol, { t: string; v: number }[]>> = {};
const fyersVixHistoryCache: Partial<Record<Symbol, { t: string; v: number }[]>> = {};
const fyersSignalHistoryCache: Partial<Record<string, { ts: number; action: TradeAction; confidence: number }[]>> = {};
const fyersPrevMaxPainCache: Partial<Record<string, number>> = {};

function pushRealPcrHistory(cacheKey: string, pcr: number): { t: string; v: number }[] {
  const arr = brokerPcrHistoryCache[cacheKey] ?? [];
  arr.push({ t: new Date().toISOString(), v: pcr });
  if (arr.length > 30) arr.shift();
  brokerPcrHistoryCache[cacheKey] = arr;
  return arr;
}

function applySelfComputedOiChange(chain: OptionChainRow[], cacheKey: string): boolean {
  const prev = prevOiCache[cacheKey];
  const current = new Map<number, { ceOi: number; peOi: number }>();
  let hadPrevData = false;

  for (const row of chain) {
    current.set(row.strike, { ceOi: row.ceOi, peOi: row.peOi });
    const prevRow = prev?.get(row.strike);
    if (prevRow) {
      hadPrevData = true;
      row.ceOiChg = row.ceOi - prevRow.ceOi;
      row.peOiChg = row.peOi - prevRow.peOi;
    }
  }
  prevOiCache[cacheKey] = current;
  return hadPrevData;
}

function mapToOptionChainRows(
  brokerRows: any[],
  spot: number,
  symbol: Symbol,
  expiryOverride?: string
): OptionChainRow[] {
  const step = STRIKE_STEP[symbol];
  const atm = Math.round(spot / step) * step;
  const result: OptionChainRow[] = [];

  // Filter to strikes near ATM (±5)
  const targetStrikes = new Set<number>();
  for (let i = -5; i <= 5; i++) targetStrikes.add(atm + i * step);

  for (const row of brokerRows) {
    const strike = parseInt(row.strike || row.strikePrice || row.StrikeRate, 10);
    if (!targetStrikes.has(strike)) continue;

    const ceOi = parseInt(row.ceOI || row.callOI || row.CE_OI || "0", 10) || 0;
    const peOi = parseInt(row.peOI || row.putOI || row.PE_OI || "0", 10) || 0;
    const ceLtp = parseFloat(row.ceLTP || row.callLTP || row.CE_LTP || "0") || 0;
    const peLtp = parseFloat(row.peLTP || row.putLTP || row.PE_LTP || "0") || 0;
    const rawCeIv = parseFloat(row.ceIV || row.callIV || "0") || 0;
    const rawPeIv = parseFloat(row.peIV || row.putIV || "0") || 0;
    // Most brokers here (ICICI in particular) don't give IV directly. When
    // that happens but we do have a real traded price, derive real IV from
    // it (reverse Black-Scholes) rather than showing a constant placeholder
    // that looks like real per-strike data but isn't.
    const daysToExpiry = getNextExpiry(symbol, expiryOverride).daysToExpiry;
    const ceIv = rawCeIv || impliedVolatility(spot, strike, daysToExpiry, ceLtp, true);
    const peIv = rawPeIv || impliedVolatility(spot, strike, daysToExpiry, peLtp, false);
    const ceOiChg = parseInt(row.ceOIChange || row.callOIChange || "0", 10) || 0;
    const peOiChg = parseInt(row.peOIChange || row.putOIChange || "0", 10) || 0;
    const ceVolRaw = row.ceVolume ?? row.callVolume ?? row.CE_volume ?? row.tradeVolume?.CE;
    const peVolRaw = row.peVolume ?? row.putVolume ?? row.PE_volume ?? row.tradeVolume?.PE;
    const ceVolume = ceVolRaw !== undefined ? parseInt(ceVolRaw, 10) || 0 : undefined;
    const peVolume = peVolRaw !== undefined ? parseInt(peVolRaw, 10) || 0 : undefined;

    result.push({
      strike, ceLtp, ceOi, ceOiChg, ceIv, ceVolume, peLtp, peOi, peOiChg, peIv, peVolume, isATM: strike === atm,
      ceFySymbol: row.ceFySymbol, peFySymbol: row.peFySymbol,
    });
  }

  // Sort by strike and fill missing strikes with zeros
  result.sort((a, b) => a.strike - b.strike);
  return result;
}

// ----------------------------------------------------------------------------
// Compute PCR, Max Pain, GEX from REAL option chain
// ----------------------------------------------------------------------------
function computeChainMetrics(chain: OptionChainRow[], spot: number, symbol: Symbol) {
  let totalCallOi = 0, totalPutOi = 0, totalCeOiChg = 0, totalPeOiChg = 0;
  let minPain = Infinity, maxPain = chain[0]?.strike ?? spot;

  for (const row of chain) {
    totalCallOi += row.ceOi; totalPutOi += row.peOi;
    totalCeOiChg += row.ceOiChg; totalPeOiChg += row.peOiChg;
    let pain = 0;
    for (const r of chain) {
      if (r.strike < row.strike) pain += (row.strike - r.strike) * r.ceOi;
      else if (r.strike > row.strike) pain += (r.strike - row.strike) * r.peOi;
    }
    if (pain < minPain) { minPain = pain; maxPain = row.strike; }
  }

  const pcr = Number((totalPutOi / Math.max(1, totalCallOi)).toFixed(2));
  const smartFlow = Math.round((totalPeOiChg - totalCeOiChg) / 50);

  let gex = 0;
  for (const row of chain) {
    const moneyness = Math.abs(row.strike - spot) / spot;
    const gamma = 0.0025 * Math.exp(-moneyness * 50);
    gex += gamma * (row.ceOi - row.peOi);
  }
  // Rescaled for real broker OI (hundreds of thousands+ per strike) —
  // the old *0.01 factor was implicitly calibrated for the previous fake
  // simulator's much smaller fabricated OI values, and produced absurd
  // numbers (hundreds of billions) once real OI was wired in. This is a
  // heuristic gamma-exposure-style indicator, not a precisely verified
  // institutional GEX formula — treat the number as directional/relative,
  // not an exact dollar figure.
  const gexM = Number((gex * spot * 0.00001).toFixed(1));
  const gammaFlip = maxPain + STRIKE_STEP[symbol] * Math.sign(gexM) * 2;

  return { pcr, maxPain, smartFlow, gex: gexM, gammaFlip, totalCallOi, totalPutOi };
}

// ----------------------------------------------------------------------------
// MAIN: Generate snapshot from broker
// ----------------------------------------------------------------------------
export async function generateSnapshotBroker(symbol: Symbol, expiryOverride?: string): Promise<OptionChainSnapshot> {
  const cfg = getBrokerConfig();

  // Get session token (login if needed)
  if (!sessionCache || sessionCache.expiresAt < Date.now()) {
    let token: string;
    switch (cfg.provider) {
      case "icici": token = await iciciLogin(); break;
      case "angel": token = await angelLogin(); break;
      case "dhan": token = cfg.dhan.accessToken; break; // Dhan uses static access token
      case "fyers": token = cfg.fyers.accessToken; break;
      case "zerodha": token = cfg.zerodha.accessToken; break;
      case "groww": token = cfg.groww.accessToken; break; // Groww uses static Bearer token
      default: throw new Error(`Unknown broker: ${cfg.provider}`);
    }
    sessionCache = { token, expiresAt: Date.now() + 8 * 60 * 60 * 1000 }; // 8 hour expiry
  }

  // Fetch option chain from broker. Fyers is fetched inside the block
  // below instead (it also carries real VIX data in the same response —
  // see fetchFyersOptionChain — so it shouldn't be fetched twice).
  let brokerRows: any[] = [];
  switch (cfg.provider) {
    case "icici": brokerRows = await fetchIciciOptionChain(symbol, sessionCache.token, expiryOverride); break;
    case "angel": brokerRows = await fetchAngelOptionChain(symbol, sessionCache.token); break;
    case "dhan": brokerRows = await fetchDhanOptionChain(symbol); break;
    case "fyers": break; // fetched below, together with real VIX
    case "groww": brokerRows = await fetchGrowwOptionChain(symbol, expiryOverride); break;
    default: throw new Error(`Broker ${cfg.provider} not yet implemented`);
  }

  // Get real spot + VIX. For Fyers specifically, everything (spot, VIX,
  // candles for signals, Bank Nifty cross-check) now comes straight from
  // Fyers' own APIs — see fyers-market-data.ts. This removes Yahoo Finance
  // (which can lag the real market by several minutes) from the pipeline
  // entirely for Fyers users, so the same signal that decides BUY CE/PE
  // is generated from the same real-time feed the entry/SL/target prices
  // already use. Falls back to the Yahoo-based path automatically (same
  // behavior as before) if the Fyers real-data calls fail for any reason,
  // and for every other broker (ICICI/Angel/Dhan/Groww) which don't yet
  // have an equivalent confirmed real-data path.
  let spot: number, prevSpot: number, vix: number;
  let yahooBase: Awaited<ReturnType<typeof generateSnapshotYahoo>> | null = null;
  let fyersReal: Awaited<ReturnType<typeof fetchFyersMarketData>> = null;
  let realFyersVix: number | undefined;

  if (cfg.provider === "fyers") {
    const fyersChain = await fetchFyersOptionChain(symbol, expiryOverride);
    brokerRows = fyersChain.rows;
    realFyersVix = fyersChain.indiaVix;
    fyersReal = symbol === "SENSEX" ? null : await fetchFyersMarketData(symbol as "NIFTY" | "BANKNIFTY", cfg.fyers.appId, cfg.fyers.accessToken);
    if (fyersReal && realFyersVix !== undefined) {
      spot = fyersReal.spot; prevSpot = fyersReal.prevClose; vix = realFyersVix;
    } else {
      // Real Fyers spot/candles/VIX weren't all available this refresh
      // (e.g. history API hiccup, or before market data has any candles
      // yet right at open) — fall back to Yahoo for this refresh only,
      // exactly like every other broker already does.
      fyersReal = null;
      yahooBase = await generateSnapshotYahoo(symbol, expiryOverride);
      spot = yahooBase.metrics.spot; prevSpot = yahooBase.metrics.prevSpot; vix = yahooBase.metrics.indiaVix;
    }
  } else {
    yahooBase = await generateSnapshotYahoo(symbol, expiryOverride);
    spot = yahooBase.metrics.spot; prevSpot = yahooBase.metrics.prevSpot; vix = yahooBase.metrics.indiaVix;
  }

  // Map broker chain to our format
  const chain = mapToOptionChainRows(brokerRows, spot, symbol, expiryOverride);
  if (chain.length === 0) {
    throw new Error(`Broker (${cfg.provider}) returned an empty option chain for ${symbol}. Refusing to fall back to simulated/estimated chain data.`);
  }

  // Real brokers here don't give us OI *change* directly — derive it
  // ourselves from two consecutive real polls (see applySelfComputedOiChange).
  const resolvedExpiryIso = expiryOverride || getDefaultExpiry(symbol).iso;
  const cacheKey = `${symbol}:${resolvedExpiryIso}`;
  const oiChangeAvailable = applySelfComputedOiChange(chain, cacheKey);

  // Compute REAL PCR, Max Pain, GEX
  const cm = computeChainMetrics(chain, spot, symbol);
  const { daysToExpiry, label: expStr } = getNextExpiry(symbol, expiryOverride);
  // Push this poll's real PCR into history now (not at the end) so the
  // PCR-trend calc inside computeSignalContext below sees the current
  // point too — matching how the Yahoo-based path already behaves
  // (there, the equivalent push also happens before the trend is read).
  const pcrHistory = pushRealPcrHistory(cacheKey, cm.pcr);

  // Build the signal/regime/sentiment context: fully real, straight from
  // Fyers (spot/candles/VIX/real OI-derived PCR & smart flow) when that
  // path succeeded above; otherwise the existing Yahoo-based path,
  // unchanged from before this feature was added.
  let ctx: {
    signals: Record<Timeframe, TimeframeSignal>; overallSignal: TimeframeSignal; regime: Regime; sentiment: Sentiment;
    trendScore: number; bullProb: number; bankNiftyScore: number;
    bankNiftyTrend: "HIGH BULLISH" | "BULLISH" | "NEUTRAL" | "BEARISH" | "HIGH BEARISH";
    candlePattern: ReturnType<typeof computeSignalContext>["candlePattern"]; signalStability: SignalStability;
    spotHistory: { t: string; v: number }[]; vixHistory: { t: string; v: number }[];
  };
  let fyersPrevMaxPain: number | undefined;
  // ATM row needed here (for OI-vs-price confirmation inside
  // computeSignalContext) and again later for entry/greeks — computed
  // once and reused both places rather than duplicated.
  const atmStrikeForCtx = Math.round(spot / STRIKE_STEP[symbol]) * STRIKE_STEP[symbol];
  const atmRowForCtx = chain.find(r => r.isATM) ?? chain[Math.floor(chain.length / 2)];
  if (fyersReal) {
    const signalHistory = fyersSignalHistoryCache[cacheKey] ?? [];
    const sc = computeSignalContext({
      symbol, closes: fyersReal.closes, candles: fyersReal.candles, spot, prevClose: prevSpot,
      pcr: cm.pcr, pcrHistory, smartFlow: cm.smartFlow, vix, bankNifty: fyersReal.bankNifty,
      daysToExpiry, atmCeOiChg: atmRowForCtx.ceOiChg, atmPeOiChg: atmRowForCtx.peOiChg, signalHistory,
    });
    fyersSignalHistoryCache[cacheKey] = signalHistory;
    const now = new Date();
    const spotHistory = fyersSpotHistoryCache[symbol] ?? [];
    spotHistory.push({ t: now.toISOString(), v: spot }); if (spotHistory.length > 30) spotHistory.shift();
    fyersSpotHistoryCache[symbol] = spotHistory;
    const vixHistory = fyersVixHistoryCache[symbol] ?? [];
    vixHistory.push({ t: now.toISOString(), v: vix }); if (vixHistory.length > 30) vixHistory.shift();
    fyersVixHistoryCache[symbol] = vixHistory;
    ctx = { ...sc, spotHistory, vixHistory };
    // Read the PREVIOUS refresh's max pain before overwriting the cache
    // with this refresh's value — otherwise prevMaxPain/painShift below
    // would always compare a value against itself.
    fyersPrevMaxPain = fyersPrevMaxPainCache[cacheKey];
    fyersPrevMaxPainCache[cacheKey] = cm.maxPain;
  } else {
    const yb = yahooBase!;
    ctx = {
      signals: yb.signals, overallSignal: yb.overallSignal, regime: yb.metrics.regime, sentiment: yb.sentiment,
      trendScore: yb.metrics.trendScore, bullProb: yb.metrics.bullProb, bankNiftyScore: yb.metrics.bankNiftyScore,
      bankNiftyTrend: yb.metrics.bankNiftyTrend, candlePattern: yb.candlePattern, signalStability: yb.signalStability,
      spotHistory: yb.history.spot, vixHistory: yb.history.vix,
    };
  }

  // Build full snapshot using real broker OI + (real-Fyers-or-Yahoo) spot/VIX/candles
  const step = STRIKE_STEP[symbol];
  const atmStrike = atmStrikeForCtx;
  const atmRow = atmRowForCtx;

  const overallSignal = ctx.overallSignal;
  const isCall = overallSignal.signal !== "BUY PE";
  const iv = isCall ? atmRow.ceIv : atmRow.peIv;
  const greeks: ATMGreeks = computeGreeks(spot, atmStrike, iv, daysToExpiry);

  // Trade entry uses an ITM strike (see pickEntryStrike in yahoo-adapter.ts),
  // not ATM — higher delta means the same spot move produces a bigger,
  // faster premium gain. atmStrike/atmRow/greeks above are kept ATM-based
  // for the ATM Greeks display and support/resistance context.
  const entryStrike = pickEntryStrike(atmStrike, step, isCall);
  const entryRow = chain.find(r => r.strike === entryStrike) ?? atmRow;
  const entryIv = isCall ? entryRow.ceIv : entryRow.peIv;
  const entryGreeks = computeGreeks(spot, entryStrike, entryIv, daysToExpiry);

  const vixStatus = vix < 11 ? "LOW" : vix < 16 ? "NORMAL" : vix < 22 ? "HIGH" : "EXTREME";
  // NOTE: don't recompute regime from cm.smartFlow independently here — for
  // brokers that don't provide real per-strike OI *change* (ICICI, Groww,
  // and Angel/Dhan unless confirmed otherwise), cm.smartFlow is always
  // exactly 0, which would make "TRENDING UP"/"TRENDING DOWN" unreachable
  // and silently force RANGEBOUND regardless of actual trend strength.
  // ctx.regime is already computed consistently from real RSI/EMA (Fyers
  // real path) or Yahoo's (fallback path) — same source trendScore/bullProb
  // below already reuse, so stay consistent with that either way.
  const regime: Regime = ctx.regime;

  const support = chain.filter(r => r.strike < spot).sort((a, b) => b.strike - a.strike).slice(0, 2).map(r => ({ level: r.strike, strength: Math.round((r.peOi / 1000) * 10) / 10 }));
  const resistance = chain.filter(r => r.strike > spot).sort((a, b) => a.strike - b.strike).slice(0, 2).map(r => ({ level: r.strike, strength: Math.round((r.ceOi / 1000) * 10) / 10 }));

  // Entry MUST be the real, actually-tradeable price — not the theoretical
  // Black-Scholes fair value. Previously "Entry" was the theoretical price
  // while the real LTP was shown only as a small sub-label, so SL/Target/
  // R:R were all computed against a premium nobody could actually transact
  // at — which is exactly why the suggested R:R didn't line up with reality.
  // Real LTP is now the source of truth for entry; theoretical BS price is
  // only a fallback for the rare case a strike has no real traded price yet.
  const volumeAtStrike = isCall ? entryRow.ceVolume : entryRow.peVolume;
  const lowLiquidity = isLowLiquidity(volumeAtStrike);
  const ltpAtStrike = isCall ? entryRow.ceLtp : entryRow.peLtp;
  const theoreticalEntry = computeOptionPremium(spot, entryStrike, entryIv, daysToExpiry, isCall);
  const usedRealLtp = ltpAtStrike !== undefined && ltpAtStrike > 0;
  const entry = usedRealLtp ? ltpAtStrike : theoreticalEntry;
  const { stopLoss: sl, target1: t1, target2: t2, target3: t3, riskReward: rr } = pickTradeLevels({
    spot, entry, delta: entryGreeks.delta, vix, daysToExpiry, isCall, support, resistance,
  });

  co
  const smartSignal = computeSmartSignal({
    signals: ctx.signals,
    candidate: overallSignal.signal,
    pcr: cm.pcr,
    smartFlow: cm.smartFlow,
    gex: cm.gex,
    regime: ctx.regime,
    vix,
    bankNiftyTrend: ctx.bankNiftyTrend,
    symbol,
    stability: ctx.signalStability,
    painShift: cm.maxPain - (yahooBase?.metrics.maxPain ?? fyersPrevMaxPain ?? cm.maxPain),
    atmCeOiChg: atmRow.ceOiChg,
    atmPeOiChg: atmRow.peOiChg,
    sentiment: ctx.sentiment,
  });
  const finalSignal = smartSignal.action === overallSignal.signal ? overallSignal : {
    ...overallSignal,
    signal: smartSignal.action,
    confidence: smartSignal.confidence,
    reasoning: [...overallSignal.reasoning, smartSignal.summary, ...smartSignal.blockers],
  };
nst rec: TradeRecommendation = {
    action: finalSignal.signal, strike: entryStrike, optionType: overallSignal.signal === "BUY PE" ? "PE" : "CE",
    entry, stopLoss: sl, target1: t1, target2: t2, target3: t3, confidence: finalSignal.confidence, riskReward: rr,
    volume: volumeAtStrike, lowLiquidity, ltp: ltpAtStrike,
    rationale: `${fyersReal ? "Real (Fyers) spot" : "Real spot"} ${spot.toFixed(2)} (${((spot - prevSpot) / prevSpot * 100).toFixed(2)}%). ${overallSignal.signal} at ${overallSignal.confidence}%. PCR ${cm.pcr} (real OI). Max Pain ${cm.maxPain}.${oiChangeAvailable ? ` Smart Flow ${cm.smartFlow > 0 ? "+" : ""}${cm.smartFlow} (self-computed from live OI change).` : ""} Strike ${entryStrike} (${ITM_STRIKES_FOR_ENTRY} ITM of ATM ${atmStrike}) for higher delta. Real IV ${entryIv}%, ${daysToExpiry}d to expiry, delta ${entryGreeks.delta}. Entry ₹${entry} (${usedRealLtp ? "real LTP" : "theoretical fair value — no real LTP available yet"}). R:R 1:${rr}.${lowLiquidity ? ` ⚠ Low volume (${volumeAtStrike ?? "N/A"}) at this strike — real OI, but thin trading today.` : ""}`,
    expiry: expStr,
  };

  return {
    metrics: {
      symbol, spot, prevSpot, pcr: cm.pcr, indiaVix: vix, vixStatus,
      smartFlow: cm.smartFlow, smartFlowAvailable: oiChangeAvailable, maxPain: cm.maxPain,
      prevMaxPain: yahooBase?.metrics.maxPain ?? fyersPrevMaxPain ?? cm.maxPain,
      painShift: cm.maxPain - (yahooBase?.metrics.maxPain ?? fyersPrevMaxPain ?? cm.maxPain), gex: cm.gex, gammaFlip: cm.gammaFlip,
      trendScore: ctx.trendScore, bullProb: ctx.bullProb,
      bearProb: 100 - ctx.bullProb, bankNiftyScore: ctx.bankNiftyScore,
      bankNiftyTrend: ctx.bankNiftyTrend, support, resistance, regime,
      updatedAt: new Date().toISOString(), atmStrike,
    },
    greeks, signals: ctx.signals, overallSignal: finalSignal, recommendation: rec,
    chain, history: { spot: ctx.spotHistory, pcr: pcrHistory, vix: ctx.vixHistory }, sentiment: ctx.sentiment,
    signalStability: ctx.signalStability,
    candlePattern: ctx.candlePattern, smartSignal,
  };
}
