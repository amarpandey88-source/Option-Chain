// ============================================================================
// Fyers live tick stream — WebSocket data socket, active-trade-only
// ----------------------------------------------------------------------------
// Streaming the ENTIRE option chain tick-by-tick would mean subscribing to
// ~20-30 strikes continuously, decoding a firehose of ticks the app mostly
// doesn't need (PCR/Max Pain/GEX are OI-snapshot metrics anyway — see the
// comment in broker-adapter.ts — they don't get more accurate from faster
// ticks). Instead, this only ever subscribes to the ONE option symbol that's
// actually in an open trade, for exactly as long as that trade is open. That
// keeps this both low-risk (one symbol, short-lived connection) and where it
// actually matters: detecting a real SL/target cross the instant it happens,
// not up to one poll-interval late.
//
// Uses Fyers' own official `fyers-api-v3` npm SDK for the WebSocket itself
// (see https://www.npmjs.com/package/fyers-api-v3, "Getting started data
// WebSocket") rather than hand-decoding Fyers' binary/protobuf wire format
// ourselves — that format isn't publicly documented in enough detail to
// reimplement correctly, and getting it wrong would silently produce
// garbage prices, which is far worse than not having tick data at all. The
// SDK handles that decoding and hands back a plain JS object per tick.
//
// Caveat, stated plainly: the exact field names inside that per-tick object
// (e.g. whether last traded price comes back as `ltp`, `lp`, or something
// else) are NOT confirmed from Fyers' public docs/README — only the
// connect/subscribe/on("message", ...) API surface itself is (verified by
// installing the real package and reading its README + sample code, not
// guessed). extractLtp() below defensively tries several plausible field
// names and simply ignores a tick if none match, rather than risk acting on
// a wrong number. If live ticks never seem to arrive, this is the first
// place to check with real Fyers credentials.
// ============================================================================

import { fyersDataSocket as DataSocket } from "fyers-api-v3";

export interface FyersTick {
  symbol: string;
  ltp: number;
  ts: number;
}

type TickListener = (tick: FyersTick) => void;

interface SocketHandle {
  skt: any;
  connected: boolean;
  subscribers: Map<string, Set<TickListener>>; // symbol -> listeners
  idleTimer: ReturnType<typeof setTimeout> | null;
}

let handle: SocketHandle | null = null;
const IDLE_CLOSE_MS = 2 * 60 * 1000; // close the socket 2 min after the last subscriber leaves — cheap to reopen, no reason to hold a connection with nothing subscribed

// Debug visibility for the exact issue flagged above: if ticks are
// connecting but nothing ever renders live, the most likely cause is that
// extractLtp's guessed field names don't match what Fyers actually sends.
// Logs the raw shape of the first few unparseable messages (capped, so a
// genuinely broken/noisy feed doesn't spam the console forever) so the
// real field names can be read straight from the server console/terminal
// and extractLtp fixed to match exactly, instead of guessing again.
let unparseableLogCount = 0;
const MAX_UNPARSEABLE_LOGS = 5;
let parsedLogCount = 0;
const MAX_PARSED_LOGS = 3;

function extractLtp(msg: any): { symbol: string; ltp: number } | null {
  const symbol = msg?.symbol ?? msg?.n ?? msg?.s;
  const rawLtp = msg?.ltp ?? msg?.lp ?? msg?.last_price ?? msg?.lastTradedPrice;
  const ltp = Number(rawLtp);
  if (!symbol || !Number.isFinite(ltp) || ltp <= 0) {
    if (unparseableLogCount < MAX_UNPARSEABLE_LOGS) {
      unparseableLogCount++;
      console.log(`[fyers-tick-stream] DEBUG could not extract symbol/ltp from message #${unparseableLogCount} — raw shape:`, JSON.stringify(msg));
    }
    return null;
  }
  if (parsedLogCount < MAX_PARSED_LOGS) {
    parsedLogCount++;
    console.log(`[fyers-tick-stream] DEBUG successfully parsed tick #${parsedLogCount}: symbol=${symbol} ltp=${ltp}`);
  }
  return { symbol, ltp };
}

function ensureSocket(appId: string, accessToken: string): SocketHandle {
  if (handle) return handle;
  const skt = DataSocket.getInstance(`${appId}:${accessToken}`, "", false);
  const h: SocketHandle = { skt, connected: false, subscribers: new Map(), idleTimer: null };

  skt.on("connect", () => {
    h.connected = true;
    console.log("[fyers-tick-stream] DEBUG WebSocket connected");
    const symbols = Array.from(h.subscribers.keys());
    if (symbols.length > 0) {
      console.log("[fyers-tick-stream] DEBUG subscribing on connect:", symbols);
      skt.subscribe(symbols);
    }
  });
  skt.on("message", (msg: any) => {
    const parsed = extractLtp(msg);
    if (!parsed) return;
    const listeners = h.subscribers.get(parsed.symbol);
    if (!listeners || listeners.size === 0) return;
    const tick: FyersTick = { symbol: parsed.symbol, ltp: parsed.ltp, ts: Date.now() };
    for (const fn of listeners) {
      try { fn(tick); } catch (err) { console.error("[fyers-tick-stream] listener error:", err); }
    }
  });
  skt.on("error", (err: any) => console.error("[fyers-tick-stream] socket error:", err));
  skt.on("close", () => { h.connected = false; console.log("[fyers-tick-stream] DEBUG WebSocket closed"); });

  try {
    skt.autoreconnect?.(6);
  } catch {
    // Older/newer SDK builds may not expose this exact method name —
    // non-fatal, the socket still works without client-side auto-reconnect,
    // callers just won't get ticks again until the next subscribe() call
    // naturally reconnects it.
  }
  skt.connect();
  handle = h;
  return h;
}

function scheduleIdleClose() {
  if (!handle) return;
  if (handle.idleTimer) clearTimeout(handle.idleTimer);
  handle.idleTimer = setTimeout(() => {
    if (!handle || handle.subscribers.size > 0) return;
    try { handle.skt.close(); } catch { /* already closed, fine */ }
    handle = null;
  }, IDLE_CLOSE_MS);
}

// Subscribe to live ticks for one Fyers symbol (e.g. the exact
// ceFySymbol/peFySymbol on the active trade's strike — see types.ts).
// Returns an unsubscribe function; call it when the trade closes or the
// caller (e.g. the SSE route below) disconnects.
export function subscribeFyersTick(
  fySymbol: string,
  appId: string,
  accessToken: string,
  onTick: TickListener
): () => void {
  const h = ensureSocket(appId, accessToken);
  if (h.idleTimer) { clearTimeout(h.idleTimer); h.idleTimer = null; }

  let listeners = h.subscribers.get(fySymbol);
  const isNewSymbol = !listeners;
  if (!listeners) { listeners = new Set(); h.subscribers.set(fySymbol, listeners); }
  listeners.add(onTick);

  if (isNewSymbol && h.connected) {
    console.log("[fyers-tick-stream] DEBUG subscribing (already connected):", fySymbol);
    try { h.skt.subscribe([fySymbol]); } catch (err) { console.error("[fyers-tick-stream] subscribe failed:", err); }
  } else if (isNewSymbol) {
    console.log("[fyers-tick-stream] DEBUG queued subscription (socket not yet connected):", fySymbol);
  }

  return () => {
    const set = h.subscribers.get(fySymbol);
    if (!set) return;
    set.delete(onTick);
    if (set.size === 0) {
      h.subscribers.delete(fySymbol);
      try { h.skt.unsubscribe?.([fySymbol]); } catch { /* socket may already be closed */ }
      if (h.subscribers.size === 0) scheduleIdleClose();
    }
  };
}
