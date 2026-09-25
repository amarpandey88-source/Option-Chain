import type { Symbol, OptionChainSnapshot } from "./types";
import { isBrokerConfigured, getBrokerConfig } from "./broker-adapter";
import { subscribeFyersTick } from "./fyers-tick-stream";
import { isPastNewEntryCutoff } from "./market-hours";

// ============================================================================
// Multi-symbol background watcher
// ----------------------------------------------------------------------------
// The live dashboard only ever shows ONE symbol at a time — this watcher
// keeps polling all three (NIFTY/BANKNIFTY/SENSEX) in the background,
// independent of whichever one is on screen, and fires a trade (journals it
// + sends Telegram/desktop alerts) the moment any of them produces a
// genuinely high-confidence, stable signal.
//
// Deliberately hands-off for whichever symbol the frontend says it's
// currently viewing (see setActivelyViewedSymbol / the heartbeat the
// frontend sends) — that one already gets its own live-tick monitoring
// straight from the page (see page.tsx), so this watcher would just be a
// redundant second opinion on it. It only manages the OTHER two.
//
// Any trade THIS watcher fires also gets real-time tick-level monitoring
// (see ensureTickSubscription below) — not just the 20s poll — using the
// exact same Fyers WebSocket mechanism the dashboard's own active trade
// uses (src/lib/fyers-tick-stream.ts), so a background-fired trade's
// SL/target is detected the instant it's actually crossed, the same as
// one you're watching live.
//
// Runs as a single setInterval inside the Next.js server process (started
// lazily — see ensureWatcherStarted, called from the option-chain route so
// it starts as soon as the app is actually used, not on every cold
// module load during build/type-checking).
// ============================================================================

const ALL_SYMBOLS: Symbol[] = ["NIFTY", "BANKNIFTY", "SENSEX"];
const POLL_INTERVAL_MS = 20_000;
const HIGH_CONFIDENCE_THRESHOLD = 80;
const LOT_SIZE: Record<Symbol, number> = { NIFTY: 65, BANKNIFTY: 30, SENSEX: 20 };
// Same discipline the live dashboard's own alert engine already applies
// (see the default AlertConfig in alert-manager.tsx) — the background
// watcher had none of this originally, which is exactly what let it fire
// repeatedly/continuously with no restraint. Mirrored here per-symbol
// since the watcher manages up to two symbols independently.
const MAX_TRADES_PER_DAY_PER_SYMBOL = 2;
const DAILY_LOSS_LIMIT_PER_SYMBOL = 2000;
const COOLOFF_AFTER_LOSS_MIN = 15;

let started = false;
let activelyViewedSymbol: Symbol | null = null;
let activelyViewedAt = 0;
const ACTIVE_VIEW_TIMEOUT_MS = 90_000; // if the frontend stops sending heartbeats (tab closed, etc.), release the symbol back to background watching after this long

interface WatchStatus {
  symbol: Symbol;
  lastCheckedAt: number;
  lastSignal: string;
  lastConfidence: number;
  openTradeId: string | null;
  openTradePremium: number | null;
  lastKnownSpot: number | null;
  tickLive: boolean;
  error: string | null;
}
const status: Record<Symbol, WatchStatus> = Object.fromEntries(
  ALL_SYMBOLS.map(s => [s, { symbol: s, lastCheckedAt: 0, lastSignal: "WAIT", lastConfidence: 0, openTradeId: null, openTradePremium: null, lastKnownSpot: null, tickLive: false, error: null }])
) as Record<Symbol, WatchStatus>;

// One live tick subscription per symbol for whatever trade the watcher is
// currently managing there — see ensureTickSubscription/releaseTickSubscription.
const tickUnsubscribers: Partial<Record<Symbol, () => void>> = {};

// Called by the frontend on symbol change (see the heartbeat effect in
// page.tsx) so this watcher knows to leave that one alone.
export function setActivelyViewedSymbol(symbol: Symbol | null) {
  const previous = activelyViewedSymbol;
  activelyViewedSymbol = symbol;
  activelyViewedAt = Date.now();
  // The symbol just handed BACK to background watching (frontend switched
  // away from it) keeps no stale tick subscription hanging around; the
  // next poll cycle re-subscribes it fresh if it still has an open trade.
  if (previous && previous !== symbol) releaseTickSubscription(previous);
  // The symbol just taken over BY the frontend shouldn't keep this
  // watcher's own tick subscription running alongside the page's own one.
  if (symbol) releaseTickSubscription(symbol);
}

function currentlyHandsOff(symbol: Symbol): boolean {
  if (activelyViewedSymbol !== symbol) return false;
  return Date.now() - activelyViewedAt < ACTIVE_VIEW_TIMEOUT_MS;
}

export function getWatchStatus() {
  return { symbols: ALL_SYMBOLS.map(s => ({ ...status[s], handsOff: currentlyHandsOff(s) })) };
}

function getPremiumFromChain(chain: OptionChainSnapshot["chain"], strike: number, optionType: "CE" | "PE"): number | undefined {
  const row = chain.find(r => r.strike === strike);
  if (!row) return undefined;
  return optionType === "CE" ? row.ceLtp : row.peLtp;
}

function getFySymbolFromChain(chain: OptionChainSnapshot["chain"], strike: number, optionType: "CE" | "PE"): string | undefined {
  const row = chain.find(r => r.strike === strike);
  if (!row) return undefined;
  return optionType === "CE" ? row.ceFySymbol : row.peFySymbol;
}

async function sendTelegram(message: string) {
  try {
    const { getTelegramConfig } = await import("./telegram-config");
    const cfg = getTelegramConfig();
    if (!cfg) return;
    await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cfg.chatId, text: message, parse_mode: "HTML" }),
    });
  } catch (err) {
    console.error("[multi-symbol-watcher] Telegram send failed:", err);
  }
}

// Electron's main-process Notification API — only available when this
// server is actually running inside the packaged/dev Electron app (see
// electron/main.js, which runs the Next.js server in-process). Guarded so
// this never throws when running as a plain `next dev`/`next start` outside
// Electron (e.g. this same code path executing during `next build`'s page
// data collection, or a non-Electron deployment).
async function sendDesktopNotification(title: string, body: string) {
  if (!process.versions.electron) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- must stay a runtime require, not a static import: 'electron' isn't resolvable when this code runs outside Electron (plain `next build`/`next start`), and this whole function already no-ops in that case via the process.versions.electron guard above.
    const { Notification } = require("electron");
    new Notification({ title, body }).show();
  } catch (err) {
    console.error("[multi-symbol-watcher] desktop notification failed:", err);
  }
}

function releaseTickSubscription(symbol: Symbol) {
  const unsub = tickUnsubscribers[symbol];
  if (unsub) { try { unsub(); } catch { /* already gone */ } }
  delete tickUnsubscribers[symbol];
  status[symbol].tickLive = false;
}

interface OpenTradeRecord {
  id: string; strike: number; optionType: "CE" | "PE"; action: string;
  stopLoss: number; target1: number; entryPremium: number; openedAt: string;
}

async function closeTrade(symbol: Symbol, trade: OpenTradeRecord, premium: number, exitReason: string, exitSpot: number) {
  releaseTickSubscription(symbol);
  const lotSize = LOT_SIZE[symbol];
  const pnlPerLot = premium - trade.entryPremium;
  const totalPnl = pnlPerLot * lotSize;
  const pnlPercent = (pnlPerLot / trade.entryPremium) * 100;
  const durationSec = Math.round((Date.now() - new Date(trade.openedAt).getTime()) / 1000);
  try {
    await fetch(`http://127.0.0.1:3000/api/trade-journal/${trade.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: exitReason, exitReason, exitPremium: premium, exitSpot, pnlPerLot, totalPnl, pnlPercent, durationSec }),
    });
  } catch (err) {
    console.error(`[multi-symbol-watcher] failed to close trade for ${symbol}:`, err);
    return;
  }
  status[symbol].openTradeId = null;
  status[symbol].openTradePremium = null;
  const emoji = exitReason === "SL_HIT" ? "🔻" : exitReason === "TARGET1_HIT" ? "🎯" : "⏰";
  await sendTelegram(`${emoji} <b>[Background] ${exitReason.replace("_", " ")}: ${trade.action} ${symbol} ${trade.strike}</b>\nExited at ~₹${premium.toFixed(0)} (P&L ₹${totalPnl.toFixed(0)})`);
  await sendDesktopNotification(`[Background] ${exitReason.replace("_", " ")}: ${symbol}`, `Exited at ~₹${premium.toFixed(0)} (P&L ₹${totalPnl.toFixed(0)})`);
}

// Subscribes to real-time ticks for a background-fired trade's exact
// option (Fyers only — the tick stream needs the broker's own real
// symbol string, which only Fyers rows carry, see ceFySymbol/peFySymbol
// on OptionChainRow). No-ops (silently stays on the 20s poll) for every
// other broker or for Yahoo mode — same as the dashboard's own live-tick
// feature already does.
function ensureTickSubscription(symbol: Symbol, trade: OpenTradeRecord, chain: OptionChainSnapshot["chain"]) {
  if (tickUnsubscribers[symbol]) return; // already subscribed for this symbol's current open trade
  const cfg = getBrokerConfig();
  if (cfg.provider !== "fyers") return;
  const fySymbol = getFySymbolFromChain(chain, trade.strike, trade.optionType);
  if (!fySymbol) return;

  const unsub = subscribeFyersTick(fySymbol, cfg.fyers.appId, cfg.fyers.accessToken, (t) => {
    status[symbol].openTradePremium = t.ltp;
    // Tick payload only carries the option's own LTP, not the underlying
    // spot — exitSpot here is the most recent spot seen from the regular
    // poll (see tick()'s status[symbol].lastKnownSpot update), a close
    // enough approximation for the journal's record-keeping field; it
    // isn't used in any P&L math (that's entirely premium-based).
    const approxSpot = status[symbol].lastKnownSpot ?? 0;
    if (t.ltp <= trade.stopLoss) {
      closeTrade(symbol, trade, t.ltp, "SL_HIT", approxSpot);
    } else if (t.ltp >= trade.target1) {
      closeTrade(symbol, trade, t.ltp, "TARGET1_HIT", approxSpot);
    }
  });
  tickUnsubscribers[symbol] = unsub;
  status[symbol].tickLive = true;
}

async function fireTrade(symbol: Symbol, snapshot: OptionChainSnapshot, dataSourceLabel: string) {
  const rec = snapshot.recommendation;
  const alertId = `bg-${symbol}-${Date.now()}`;
  try {
    const res = await fetch("http://127.0.0.1:3000/api/trade-journal", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        alertId, symbol, action: rec.action, optionType: rec.optionType, strike: rec.strike,
        entryPremium: rec.entry, stopLoss: rec.stopLoss, target1: rec.target1, target2: rec.target2, target3: rec.target3,
        entrySpot: snapshot.metrics.spot, confidence: rec.confidence, sentiment: snapshot.sentiment,
        dataSource: dataSourceLabel, regime: snapshot.metrics.regime, rationale: rec.rationale,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.duplicate) return;
    status[symbol].openTradeId = data.trade.id;
    status[symbol].openTradePremium = rec.entry;
    ensureTickSubscription(symbol, { id: data.trade.id, strike: rec.strike, optionType: rec.optionType, action: rec.action, stopLoss: rec.stopLoss, target1: rec.target1, entryPremium: rec.entry, openedAt: data.trade.openedAt }, snapshot.chain);
    const emoji = rec.action === "BUY CE" ? "🟢" : "🔴";
    await sendTelegram(`${emoji} <b>[Background] ${rec.action}</b> ${symbol} ${rec.strike}\nEntry: ₹${rec.entry} | SL: ₹${rec.stopLoss} | Target: ₹${rec.target1}\nConfidence: ${rec.confidence}%\n(Fired automatically — you weren't viewing this symbol)`);
    await sendDesktopNotification(`[Background] ${rec.action} ${symbol} ${rec.strike}`, `Entry ₹${rec.entry} · SL ₹${rec.stopLoss} · Target ₹${rec.target1} · ${rec.confidence}% confidence`);
  } catch (err) {
    console.error(`[multi-symbol-watcher] failed to fire trade for ${symbol}:`, err);
  }
}

async function checkOpenTrade(symbol: Symbol, snapshot: OptionChainSnapshot) {
  try {
    const res = await fetch(`http://127.0.0.1:3000/api/trade-journal?status=OPEN&symbol=${symbol}&limit=5`, { cache: "no-store" });
    const data = await res.json();
    const openTrade: OpenTradeRecord | undefined = (data.trades || [])[0];
    if (!openTrade) { status[symbol].openTradeId = null; status[symbol].openTradePremium = null; releaseTickSubscription(symbol); return; }
    status[symbol].openTradeId = openTrade.id;

    // Keep (or start) the real-time tick subscription for this trade —
    // covers both watcher-fired trades and ones the dashboard fired that
    // later got handed to background watching (symbol no longer actively
    // viewed) rather than only trades this watcher itself opened.
    ensureTickSubscription(symbol, openTrade, snapshot.chain);

    const premium = getPremiumFromChain(snapshot.chain, openTrade.strike, openTrade.optionType);
    if (premium != null) status[symbol].openTradePremium = premium;
    if (premium == null) return;

    const isEod = isPastNewEntryCutoff(); // 3:15 PM IST square-off, shared with the new-entry cutoff above

    // SL/Target are also checked here as a fallback (covers non-Fyers
    // brokers and Yahoo mode, where ensureTickSubscription is a no-op) —
    // for Fyers, the tick subscription above usually catches a cross
    // first, and this poll just double-checks nothing was missed.
    let exitReason: string | null = null;
    if (premium <= openTrade.stopLoss) exitReason = "SL_HIT";
    else if (premium >= openTrade.target1) exitReason = "TARGET1_HIT";
    else if (isEod) exitReason = "EOD_SQUAREOFF";
    if (!exitReason) return;

    await closeTrade(symbol, openTrade, premium, exitReason, snapshot.metrics.spot);
  } catch (err) {
    console.error(`[multi-symbol-watcher] open-trade check failed for ${symbol}:`, err);
  }
}

async function getTodayStatsForSymbol(symbol: Symbol): Promise<{ count: number; totalPnl: number; lastLossClosedAt: number | null }> {
  try {
    const res = await fetch(`http://127.0.0.1:3000/api/trade-journal?symbol=${symbol}&limit=100`, { cache: "no-store" });
    const data = await res.json();
    const trades = (data.trades || []) as { status: string; openedAt: string; closedAt: string | null; totalPnl: number | null }[];
    // "Today" in IST, matching how the rest of the app reasons about the
    // trading day (EOD square-off, etc.).
    const nowIst = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const startOfDayIst = new Date(nowIst); startOfDayIst.setHours(0, 0, 0, 0);
    const closedToday = trades.filter(t => t.status !== "OPEN" && t.closedAt && new Date(new Date(t.closedAt).toLocaleString("en-US", { timeZone: "Asia/Kolkata" })) >= startOfDayIst);
    const totalPnl = closedToday.reduce((s, t) => s + (t.totalPnl ?? 0), 0);
    const losses = closedToday.filter(t => (t.totalPnl ?? 0) <= 0 && t.closedAt);
    const lastLossClosedAt = losses.length ? Math.max(...losses.map(t => new Date(t.closedAt!).getTime())) : null;
    return { count: closedToday.length, totalPnl, lastLossClosedAt };
  } catch (err) {
    console.error(`[multi-symbol-watcher] failed to fetch today's stats for ${symbol}:`, err);
    // Fail safe, not open — if we can't verify it's OK to trade, don't.
    return { count: MAX_TRADES_PER_DAY_PER_SYMBOL, totalPnl: 0, lastLossClosedAt: Date.now() };
  }
}

async function tick() {
  // The watcher is a trade-alert path, so estimated Yahoo/NSE data must never
  // be allowed to create an entry. The dashboard can still use NSE mode for
  // view-only analysis, but background monitoring requires a real broker feed.
  if (!isBrokerConfigured()) {
    for (const symbol of ALL_SYMBOLS) {
      status[symbol] = {
        ...status[symbol],
        lastCheckedAt: Date.now(),
        error: "Broker data required for background trade monitoring",
      };
    }
    return;
  }

  // Collected first, fired after the loop — see the note below on why
  // firing isn't done inline per-symbol anymore.
  const fireCandidates: { symbol: Symbol; snapshot: OptionChainSnapshot; dataSourceLabel: string }[] = [];

  for (const symbol of ALL_SYMBOLS) {
    if (currentlyHandsOff(symbol)) continue;
    try {
      const { generateSnapshotBroker } = await import("./broker-adapter");
      const { getConfiguredBroker } = await import("./broker-adapter");
      const snapshot = await generateSnapshotBroker(symbol);
      const dataSourceLabel = `broker-${getConfiguredBroker()}`;

      status[symbol] = {
        ...status[symbol], lastCheckedAt: Date.now(),
        lastSignal: snapshot.overallSignal.signal, lastConfidence: snapshot.overallSignal.confidence,
        lastKnownSpot: snapshot.metrics.spot, error: null,
      };

      await checkOpenTrade(symbol, snapshot);

      const highConfidenceSignal = snapshot.overallSignal.signal !== "WAIT"
        && snapshot.overallSignal.confidence >= HIGH_CONFIDENCE_THRESHOLD
        && snapshot.signalStability.isLocked;

      if (!status[symbol].openTradeId && highConfidenceSignal) {
        // No new entries from 3:15 PM IST onward — same cutoff the EOD
        // square-off above uses to force-close open trades. Checked here
        // (not by skipping the whole symbol) so checkOpenTrade above still
        // runs every cycle and still force-closes anything already open.
        if (isPastNewEntryCutoff()) continue;
        // Don't take continuously — the same discipline the live
        // dashboard's own alert engine applies before firing (see
        // alert-manager.tsx): a daily trade cap, a loss circuit breaker,
        // a cool-off after a loss, avoiding chop, and skipping thin
        // liquidity. A high-confidence, locked signal is necessary to
        // fire but not sufficient on its own.
        if (snapshot.metrics.regime === "RANGEBOUND") continue;
        if (snapshot.recommendation.lowLiquidity) continue;

        const todayStats = await getTodayStatsForSymbol(symbol);
        if (todayStats.count >= MAX_TRADES_PER_DAY_PER_SYMBOL) continue;
        if (todayStats.totalPnl <= -Math.abs(DAILY_LOSS_LIMIT_PER_SYMBOL)) continue;
        if (todayStats.lastLossClosedAt != null && Date.now() - todayStats.lastLossClosedAt < COOLOFF_AFTER_LOSS_MIN * 60 * 1000) continue;

        fireCandidates.push({ symbol, snapshot, dataSourceLabel });
      }
    } catch (err: any) {
      status[symbol].error = err?.message || String(err);
      console.error(`[multi-symbol-watcher] tick failed for ${symbol}:`, err);
    }
  }

  // If more than one symbol independently qualifies in the SAME cycle
  // (e.g. NIFTY and BANKNIFTY both cross the confidence bar on the same
  // 20s tick), only take the single highest-confidence one — not every
  // symbol that happens to qualify at once. The others aren't lost, just
  // deferred: if still the best candidate on a later cycle (and no open
  // trade is blocking that symbol by then), they'll fire then. This is
  // "analyse first, then take the highest-probability trade" rather than
  // taking everything that clears the bar simultaneously.
  if (fireCandidates.length > 0) {
    fireCandidates.sort((a, b) => b.snapshot.overallSignal.confidence - a.snapshot.overallSignal.confidence);
    const best = fireCandidates[0];
    await fireTrade(best.symbol, best.snapshot, best.dataSourceLabel);
  }
}

export function ensureWatcherStarted() {
  if (started) return;
  started = true;
  console.log(`[multi-symbol-watcher] started — polling ${ALL_SYMBOLS.join(", ")} every ${POLL_INTERVAL_MS / 1000}s, firing at ${HIGH_CONFIDENCE_THRESHOLD}%+ confidence`);
  tick(); // fire the first check immediately rather than waiting a full interval
  setInterval(tick, POLL_INTERVAL_MS);
}
