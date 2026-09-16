"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SentimentHeader } from "@/components/option-chain/sentiment-header";
import { MetricCard } from "@/components/option-chain/metric-card";
import { SignalCard } from "@/components/option-chain/signal-card";
import { SuggestedTrade } from "@/components/option-chain/suggested-trade";
import { AlertReadinessCard } from "@/components/option-chain/alert-readiness-card";
import { AtmGreeks } from "@/components/option-chain/atm-greeks";
import { HistoryPanel } from "@/components/option-chain/history-panel";
import { CandlePatternCard } from "@/components/option-chain/candle-pattern-card";
import { OptionChainTable } from "@/components/option-chain/option-chain-table";
import { AlertBanner } from "@/components/option-chain/alert-banner";
import { AlertConfig, AlertEvent, useAlertConfig, useAlertEngine } from "@/components/option-chain/alert-manager";
import { ActiveTradePanel } from "@/components/option-chain/active-trade-panel";
import { SignalStabilityIndicator } from "@/components/option-chain/signal-stability-indicator";
import { TradeJournalPanel } from "@/components/option-chain/trade-journal-panel";
import { useAlertSound } from "@/hooks/use-alert-sound";
import { useSmoothedValue } from "@/hooks/use-smoothed-value";
import { listCandidateExpiries } from "@/lib/expiry-utils";
import { ApiKeysDialog } from "@/components/option-chain/api-keys-dialog";
import { NoDataBanner } from "@/components/option-chain/no-data-banner";
import { BackgroundWatchStrip } from "@/components/option-chain/background-watch-strip";
import { PerformanceDashboard } from "@/components/option-chain/performance-dashboard";
import { TelegramAlertsDialog } from "@/components/option-chain/telegram-alerts-dialog";
import { OptionChainSnapshot, Symbol, Timeframe, TradeRecommendation } from "@/lib/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { isPastNewEntryCutoff } from "@/lib/market-hours";

function overallSignalAction(snap: OptionChainSnapshot): "BUY CE" | "BUY PE" | null {
  const a = snap.overallSignal.signal;
  return a === "BUY CE" || a === "BUY PE" ? a : null;
}

async function fetchSnapshot(symbol: Symbol, source: "nse" | "broker", expiry?: string): Promise<OptionChainSnapshot & { dataSource?: string; alertsAllowed?: boolean }> {
  const expiryParam = expiry ? `&expiry=${expiry}` : "";
  const res = await fetch(`/api/option-chain?symbol=${symbol}&source=${source}${expiryParam}`, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.message || "Failed to fetch real market data.");
  }
  return json;
}

// Real current premium for an active trade, sourced from the live option
// chain snapshot (real broker LTP for that exact strike) — NOT a delta-based
// theoretical estimate. A fixed delta captured at entry drifts further from
// reality the longer a trade runs and the further spot moves (delta itself
// changes — gamma — and theta decay isn't modeled at all), which is exactly
// why the app's numbers could visibly diverge from a real broker's chart
// over time. Falls back to the delta estimate only if the exact strike
// genuinely isn't present in this snapshot (e.g. outside the fetched
// strike range) — real data always wins when it's available.
function getRealCurrentPremium(
  activeTrade: { strike: number; optionType: "CE" | "PE"; entryPremium: number; entryDelta: number; entrySpot: number },
  chain: { strike: number; ceLtp: number; peLtp: number }[] | undefined,
  currentSpot: number
): number {
  const row = chain?.find(r => r.strike === activeTrade.strike);
  const realLtp = row ? (activeTrade.optionType === "CE" ? row.ceLtp : row.peLtp) : undefined;
  if (realLtp !== undefined && realLtp > 0) return realLtp;
  const spotDelta = currentSpot - activeTrade.entrySpot;
  return activeTrade.entryPremium + (activeTrade.optionType === "CE" ? activeTrade.entryDelta * spotDelta : -activeTrade.entryDelta * spotDelta);
}

export default function Home() {
  const [symbol, setSymbol] = useState<Symbol>("NIFTY");

  // Heartbeat to the multi-symbol background watcher (see
  // multi-symbol-watcher.ts): tells it which symbol this tab is actively
  // viewing, so it leaves that one to this page's own faster live-tick
  // monitoring and only manages the other two in the background. Sent on
  // symbol change and periodically (so the watcher can tell a closed tab
  // apart from one that's just been quiet) — and cleared on unmount so the
  // watcher picks the symbol back up immediately rather than waiting out
  // the heartbeat timeout.
  useEffect(() => {
    const send = () => fetch("/api/multi-watch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol }) }).catch(() => {});
    send();
    const interval = setInterval(send, 45_000);
    return () => {
      clearInterval(interval);
      fetch("/api/multi-watch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: null }) }).catch(() => {});
    };
  }, [symbol]);
  const [expiry, setExpiry] = useState<string | undefined>(undefined);
  const expiryOptions = useMemo(() => listCandidateExpiries(symbol), [symbol]);
  const [dataSource, setDataSourceRaw] = useState<"nse" | "broker">("nse");
  // Tracks whether the person has ever manually picked a mode — once they
  // have, we never override their choice again. Without this flag, simply
  // reconnecting the broker (or even just the periodic re-check below)
  // would silently yank someone back to Broker mode after they'd
  // deliberately switched to NSE (Yahoo) mode for some reason.
  const userChangedSourceRef = useRef(false);
  const setDataSource = useCallback((s: "nse" | "broker") => {
    userChangedSourceRef.current = true;
    setDataSourceRaw(s);
  }, []);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [activeTab, setActiveTab] = useState<Timeframe>("5min");
  const [mainView, setMainView] = useState<"overview" | "chain">("overview");
  const [brokerConfigured, setBrokerConfigured] = useState(false);
  const [brokerProvider, setBrokerProvider] = useState<string | null>(null);
  const [brokerCheckNonce, setBrokerCheckNonce] = useState(0);

  // Check broker config status on mount + when nonce changes
  useEffect(() => {
    fetch("/api/broker-config", { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        setBrokerConfigured(d.configured);
        setBrokerProvider(d.provider ?? null);
        // If broker got disconnected while in broker mode, fall back to nse view
        if (!d.configured) setDataSourceRaw(s => (s === "broker" ? "nse" : s));
        // Default to real broker data (accurate OI/PCR/Max Pain/GEX) the
        // moment a broker is connected, instead of silently staying on
        // Yahoo's simulated-chain "nse" mode until someone notices the
        // toggle exists. Only applies before the person has ever touched
        // the toggle themselves (see userChangedSourceRef above).
        else if (!userChangedSourceRef.current) setDataSourceRaw("broker");
      })
      .catch(() => setBrokerConfigured(false));
  }, [brokerCheckNonce]);
  const [refreshIntervalSec, setRefreshIntervalSec] = useState<number>(() => {
    if (typeof window === "undefined") return 30;
    const s = localStorage.getItem("ocp-refresh-interval"); return s ? parseInt(s, 10) : 30;
  });
  const handleIntervalChange = useCallback((sec: number) => { setRefreshIntervalSec(sec); localStorage.setItem("ocp-refresh-interval", String(sec)); }, []);

  const [alertConfig, setAlertConfig] = useAlertConfig();
  const [lastAlert, setLastAlert] = useState<AlertEvent | null>(null);
  const { play: playAlertSound, preview: previewSound } = useAlertSound(alertConfig.soundEnabled);
  const [activeTrade, setActiveTrade] = useState<{
    id: string; openedAt: number; action: "BUY CE" | "BUY PE"; strike: number;
    entryPremium: number; stopLossPremium: number; target1Premium: number; target2Premium: number; target3Premium: number;
    entrySpot: number; confidence: number; optionType: "CE" | "PE"; lotSize: number; entryDelta: number;
    symbol: string; sentiment: string; rationale: string; regime?: string;
    journalStatus: "saving" | "saved" | "failed";
    slMovedToBreakeven: boolean;
  } | null>(null);

  const queryClient = useQueryClient();
  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["option-chain", symbol, expiry, refreshNonce, dataSource],
    queryFn: () => fetchSnapshot(symbol, dataSource, expiry),
    enabled: dataSource === "nse" || brokerConfigured,
    refetchInterval: autoRefresh && (dataSource === "nse" || brokerConfigured) ? refreshIntervalSec * 1000 : false,
    staleTime: refreshIntervalSec * 1000 - 1000,
    retry: 1,
  });

  // Mirrors the latest chain into a ref (no re-render) so the live-tick
  // effect below can read "whatever the chain looked like most recently"
  // at the moment a trade opens, without needing `data` itself in its
  // dependency array (which would tear down and reopen the tick stream on
  // every single poll — the whole point is for it to stay open and NOT
  // depend on polling).
  const latestChainRef = useRef(data?.chain);
  useEffect(() => { latestChainRef.current = data?.chain; }, [data?.chain]);

  // Live tick stream (Fyers only) — while a trade is open, subscribes to
  // that exact option's real Fyers symbol (see ceFySymbol/peFySymbol on
  // OptionChainRow) over a Server-Sent Events connection and updates
  // liveLtp on every tick. This is what lets SL/target be detected the
  // instant price actually crosses them, instead of up to one
  // poll-interval late. See src/lib/fyers-tick-stream.ts + the
  // /api/live-tick route for the server side of this.
  const [liveLtp, setLiveLtp] = useState<number | null>(null);
  useEffect(() => {
    setLiveLtp(null);
    if (!activeTrade || dataSource !== "broker" || brokerProvider !== "fyers") return;
    const row = latestChainRef.current?.find(r => r.strike === activeTrade.strike);
    const fySymbol = activeTrade.optionType === "CE" ? row?.ceFySymbol : row?.peFySymbol;
    if (!fySymbol) {
      // Diagnostic: if this fires, the live-tick badge will show
      // "POLLING" for a reason that has nothing to do with the Fyers
      // WebSocket itself — the chain row for this strike never got a real
      // Fyers trading symbol attached to it (see ceFySymbol/peFySymbol in
      // broker-adapter.ts's fetchFyersOptionChain). Check this log first
      // before assuming the tick stream is broken.
      console.warn("[live-tick] no ceFySymbol/peFySymbol found on chain row for strike", activeTrade.strike, "— staying on poll-interval tracking. Row:", row);
      return;
    }

    const es = new EventSource(`/api/live-tick?symbol=${encodeURIComponent(fySymbol)}`);
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "connected") console.log("[live-tick] SSE connected for", fySymbol);
        if (msg.type === "tick" && typeof msg.ltp === "number" && msg.ltp > 0) setLiveLtp(msg.ltp);
      } catch { /* malformed event — ignore, next tick will come */ }
    };
    es.onerror = () => console.warn("[live-tick] SSE connection error for", fySymbol, "— EventSource will retry automatically");
    // EventSource retries the connection on its own after a network drop;
    // nothing extra to do here besides letting that happen.
    return () => { es.close(); setLiveLtp(null); };
  }, [activeTrade?.id, activeTrade?.strike, activeTrade?.optionType, dataSource, brokerProvider]);

  const handleRefresh = useCallback(() => { setRefreshNonce(n => n + 1); refetch(); }, [refetch]);
  const handleSymbolChange = useCallback((s: Symbol) => { setSymbol(s); setExpiry(undefined); setRefreshNonce(n => n + 1); setActiveTrade(null); }, []);
  const handleExpiryChange = useCallback((e: string | undefined) => { setExpiry(e); setRefreshNonce(n => n + 1); }, []);

  // Smoothly animates the spot price between real polls instead of jumping
  // straight to the new value on each refresh — makes the live numbers feel
  // continuous like a chart rather than ticking in steps every N seconds.
  // This only eases the transition between two real fetched values; it
  // never fabricates movement that wasn't actually in the data (see the
  // hook's own comment for why that distinction matters for a trading app).
  const smoothedSpot = useSmoothedValue(data?.metrics.spot ?? 0, 900);
  const realCurrentPremium = activeTrade && data ? (liveLtp ?? getRealCurrentPremium(activeTrade, data.chain, data.metrics.spot)) : 0;

  // Background-fired open trades (from the multi-symbol watcher — see
  // multi-symbol-watcher.ts) for symbols OTHER than the one being actively
  // viewed here. The actively-viewed symbol's own trade already has its
  // own richer, live-tick-precise tracking via `activeTrade` above; this
  // is just for surfacing what the backend is independently managing on
  // the other symbols, so a trade firing on BANKNIFTY while you're looking
  // at NIFTY doesn't go unnoticed on the dashboard itself (Telegram/desktop
  // notifications already cover the "didn't have the app open" case).
  interface OpenTradeRow {
    id: string; alertId: string; symbol: string; action: string; optionType: string; strike: number;
    entryPremium: number; stopLoss: number; target1: number; confidence: number; openedAt: string;
  }
  const [otherOpenTrades, setOtherOpenTrades] = useState<OpenTradeRow[]>([]);
  const [watchLtpBySymbol, setWatchLtpBySymbol] = useState<Record<string, number>>({});
  const [watchTickLiveBySymbol, setWatchTickLiveBySymbol] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const poll = () => {
      fetch("/api/trade-journal?status=OPEN&limit=10", { cache: "no-store" })
        .then(r => r.json())
        .then(d => setOtherOpenTrades((d.trades || []).filter((t: OpenTradeRow) => t.alertId !== activeTrade?.id)))
        .catch(() => {});
      fetch("/api/multi-watch", { cache: "no-store" })
        .then(r => r.json())
        .then(d => {
          const map: Record<string, number> = {};
          const liveMap: Record<string, boolean> = {};
          for (const e of d.symbols || []) {
            if (e.openTradePremium != null) map[e.symbol] = e.openTradePremium;
            liveMap[e.symbol] = !!e.tickLive;
          }
          setWatchLtpBySymbol(map);
          setWatchTickLiveBySymbol(liveMap);
        })
        .catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 15_000);
    return () => clearInterval(interval);
  }, [activeTrade?.id]);
  const smoothedPremium = useSmoothedValue(realCurrentPremium, 900);

  // ---------------------------------------------------------------------
  // Freeze the Suggested Trade's numbers once the signal locks.
  // ---------------------------------------------------------------------
  // Without this, entry/SL/targets recompute on every refresh (spot ticks
  // a little, IV shifts a little) even though nothing about the underlying
  // trade idea has actually changed — which looks like the recommendation
  // is unstable/unreliable when it's really just normal data jitter. Once
  // locked, freeze the numbers until the locked direction itself changes,
  // so there's a stable, fixed reference to actually act on.
  const [frozenRec, setFrozenRec] = useState<{ key: string; rec: TradeRecommendation } | null>(null);
  useEffect(() => {
    if (!data) return;
    const isLocked = data.signalStability.isLocked;
    const key = `${symbol}-${data.signalStability.currentAction}`;
    if (isLocked) {
      if (!frozenRec || frozenRec.key !== key) {
        setFrozenRec({ key, rec: data.recommendation });
      }
    } else if (frozenRec) {
      setFrozenRec(null);
    }
  }, [data?.signalStability.isLocked, data?.signalStability.currentAction, symbol]);

  // Named function expression so the retry can call itself by its own name
  // (`trySave`) — that name is available throughout the function's own
  // body from the start, unlike the outer `saveTradeToJournal` binding
  // (which isn't finished being declared yet at the time this function is
  // defined, a real temporal-dead-zone hazard the earlier plain
  // self-reference had).
  const saveTradeToJournal = useCallback(function trySave(p: { id: string; symbol: string; action: "BUY CE" | "BUY PE"; strike: number; entry: number; stopLoss: number; target1: number; target2: number; target3: number; confidence: number; entrySpot: number; sentiment: string; rationale: string; regime?: string }, attempt = 1) {
    fetch("/api/trade-journal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ alertId: p.id, symbol: p.symbol, action: p.action, optionType: p.action === "BUY CE" ? "CE" : "PE", strike: p.strike, entryPremium: p.entry, stopLoss: p.stopLoss, target1: p.target1, target2: p.target2, target3: p.target3, entrySpot: p.entrySpot, confidence: p.confidence, sentiment: p.sentiment, dataSource: data?.dataSource || "broker", regime: p.regime, rationale: p.rationale }) })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const body = await res.json().catch(() => ({}));
        if (body.created) toast.success("Logged to Trade Journal", { duration: 4000 });
        queryClient.invalidateQueries({ queryKey: ["trade-journal-today"] });
        setActiveTrade(prev => (prev && prev.id === p.id) ? { ...prev, journalStatus: "saved" } : prev);
      })
      .catch(err => {
        console.error(`[journal] record failed (attempt ${attempt}):`, err);
        if (attempt < 2) {
          // Network hiccups / the schema-bootstrap race on a cold start are
          // often transient — one quick retry avoids a false "failed" state
          // for what would've succeeded a second later anyway.
          setTimeout(() => trySave(p, attempt + 1), 2000);
          return;
        }
        setActiveTrade(prev => (prev && prev.id === p.id) ? { ...prev, journalStatus: "failed" } : prev);
        // This toast disappears after 8s, but the Active Trade panel now
        // also shows a persistent "⚠ Not saved to journal" badge that
        // doesn't — so a missed toast no longer means a silently lost entry.
        toast.error("Trade journal entry failed to save", { description: String(err.message || err), duration: 8000 });
      });
  }, [data?.dataSource, queryClient]);

  // OS-level desktop notification — works even when the window is hidden
  // in the tray (see electron/main.js), since the standard web Notification
  // API maps straight to a native OS toast regardless of window visibility,
  // as long as the app process itself is still running.
  const notifyDesktop = useCallback((title: string, body: string) => {
    if (typeof window === "undefined" || typeof Notification === "undefined") return;
    try {
      if (Notification.permission === "granted") new Notification(title, { body });
      else if (Notification.permission !== "denied") Notification.requestPermission().then(p => { if (p === "granted") new Notification(title, { body }); });
    } catch { /* non-critical */ }
  }, []);

  const handleAlert = useCallback((event: AlertEvent) => {
    setLastAlert(event);
    playAlertSound(event.action === "BUY CE" ? "bull" : "bear");
    const lotSize = event.symbol === "BANKNIFTY" ? 30 : event.symbol === "SENSEX" ? 20 : 65;
    const entrySpot = data?.metrics.spot ?? 0;
    const entryDelta = data?.greeks.delta ?? 0.5;
    const sentiment = data?.sentiment ?? "NEUTRAL";
    const rationale = event.reasoning;
    setActiveTrade({ id: event.id, openedAt: event.ts, action: event.action, strike: event.strike, entryPremium: event.entry, stopLossPremium: event.stopLoss, target1Premium: event.target1, target2Premium: event.target2, target3Premium: event.target3, entrySpot, confidence: event.confidence, optionType: event.action === "BUY CE" ? "CE" : "PE", lotSize, entryDelta, symbol: event.symbol, sentiment, rationale, regime: data?.metrics.regime, journalStatus: "saving", slMovedToBreakeven: false });

    saveTradeToJournal({ id: event.id, symbol: event.symbol, action: event.action, strike: event.strike, entry: event.entry, stopLoss: event.stopLoss, target1: event.target1, target2: event.target2, target3: event.target3, confidence: event.confidence, entrySpot, sentiment, rationale, regime: data?.metrics.regime });

    // Fire-and-forget — Telegram delivery failing should never block or
    // affect the in-app alert flow above. Silently configured-or-not; the
    // route itself no-ops with an error if nothing's been set up.
    fetch("/api/telegram", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `${event.action === "BUY CE" ? "🟢" : "🔴"} <b>${event.action}</b> ${event.symbol} ${event.strike}\nEntry: ₹${event.entry} | SL: ₹${event.stopLoss} | Target: ₹${event.target1}\nConfidence: ${event.confidence}%`,
      }),
    }).catch(() => { /* not configured, or a transient network issue — non-critical */ });
    notifyDesktop(`${event.action} ${event.symbol} ${event.strike}`, `Entry ₹${event.entry} · SL ₹${event.stopLoss} · Target ₹${event.target1} · ${event.confidence}% confidence`);

    const isBull = event.action === "BUY CE";
    const Icon = isBull ? TrendingUp : TrendingDown;
    toast.custom(() => (
      <div className={`w-full max-w-md rounded-lg border-2 ${isBull ? "bg-emerald-950/90 border-emerald-600" : "bg-rose-950/90 border-rose-600"} backdrop-blur-md p-4 shadow-2xl`}>
        <div className="flex items-start gap-3">
          <div className={`h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0 ${isBull ? "bg-emerald-500/30" : "bg-rose-500/30"}`}><Icon className={`h-6 w-6 ${isBull ? "text-emerald-300" : "text-rose-300"}`} /></div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm font-bold ${isBull ? "text-emerald-300" : "text-rose-300"}`}>{isBull ? "BULLISH ALERT" : "BEARISH ALERT"}</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">{event.confidence}% conf</span>
              <span className="text-[10px] text-slate-400 font-mono">{new Date(event.ts).toLocaleTimeString("en-IN", { hour12: false })}</span>
            </div>
            <div className="text-base font-mono font-bold text-slate-100 mt-1">{event.action} {event.strike} <span className="text-xs text-slate-400">({event.symbol})</span></div>
            <div className="grid grid-cols-4 gap-1 mt-2 text-[10px] font-mono">
              <div className="bg-cyan-500/10 text-cyan-300 border border-cyan-700/30 rounded px-1.5 py-0.5 text-center">E {event.entry}</div>
              <div className="bg-rose-500/10 text-rose-300 border border-rose-700/30 rounded px-1.5 py-0.5 text-center">SL {event.stopLoss}</div>
              <div className="bg-emerald-500/10 text-emerald-300 border border-emerald-700/30 rounded px-1.5 py-0.5 text-center">T1 {event.target1}</div>
              <div className="bg-emerald-500/10 text-emerald-300 border border-emerald-700/30 rounded px-1.5 py-0.5 text-center">T2 {event.target2}</div>
            </div>
            <div className="text-[11px] text-slate-400 mt-2 leading-relaxed">{event.reasoning.slice(0, 140)}{event.reasoning.length > 140 ? "…" : ""}</div>
          </div>
        </div>
      </div>
    ), { duration: 12000 });
  }, [playAlertSound, data?.metrics.spot, data?.sentiment, data?.dataSource, notifyDesktop]);

  const alertSnapshot = data && data.alertsAllowed ? (activeTrade ? null : {
    action: overallSignalAction(data), confidence: data.overallSignal.confidence, symbol: data.metrics.symbol,
    strike: data.recommendation.strike, entry: data.recommendation.entry, stopLoss: data.recommendation.stopLoss,
    target1: data.recommendation.target1, target2: data.recommendation.target2, target3: data.recommendation.target3,
    riskReward: data.recommendation.riskReward,
    lowLiquidity: data.recommendation.lowLiquidity,
    reasoning: data.recommendation.rationale, tf5: data.signals["5min"].signal, tf15: data.signals["15min"].signal, tf30: data.signals["30min"].signal,
    regime: data.metrics.regime,
  }) : null;

  // Sourced from the journal (not a local counter) so it survives an app
  // restart mid-day and always reflects reality, not just what happened
  // since this window was opened.
  const { data: journalTodayData } = useQuery({
    queryKey: ["trade-journal-today"],
    queryFn: async () => { const res = await fetch("/api/trade-journal?limit=200", { cache: "no-store" }); if (!res.ok) throw new Error("Failed"); return res.json(); },
    refetchInterval: 15000,
    staleTime: 10000,
  });
  const tradesToday = (() => {
    if (!journalTodayData?.trades) return 0;
    const todayKey = new Date().toISOString().slice(0, 10);
    return journalTodayData.trades.filter((t: any) => new Date(t.openedAt).toISOString().slice(0, 10) === todayKey).length;
  })();
  const { todayPnl, lastLossClosedAt } = (() => {
    if (!journalTodayData?.trades) return { todayPnl: 0, lastLossClosedAt: null as number | null };
    const todayKey = new Date().toISOString().slice(0, 10);
    const closedToday = journalTodayData.trades.filter((t: any) => t.status !== "OPEN" && t.closedAt && new Date(t.closedAt).toISOString().slice(0, 10) === todayKey);
    const pnl = closedToday.reduce((s: number, t: any) => s + (t.totalPnl ?? 0), 0);
    const losses = closedToday.filter((t: any) => t.status === "SL_HIT").sort((a: any, b: any) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime());
    return { todayPnl: pnl, lastLossClosedAt: losses.length > 0 ? new Date(losses[0].closedAt).getTime() : null };
  })();

  useAlertEngine({ config: alertConfig, snapshot: alertSnapshot, stability: data?.signalStability ? { isLocked: data.signalStability.isLocked, consecutiveCount: data.signalStability.consecutiveCount } : null, tradesToday, hasActiveTrade: !!activeTrade, todayPnl, lastLossClosedAt, onAlert: handleAlert });

  // Fire-and-forget Telegram delivery for exit events (SL/target/EOD) — same
  // best-effort pattern as the entry alert above.
  const sendTelegramExit = useCallback((emoji: string, title: string, detail: string) => {
    fetch("/api/telegram", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: `${emoji} <b>${title}</b>\n${detail}` }),
    }).catch(() => {});
  }, []);

  // Active trade monitoring + auto-exit + journal update. Re-runs on every
  // poll (data changes) AND on every live tick (liveLtp changes, Fyers
  // only) — the latter is what makes SL/target detection instant instead
  // of up to one poll-interval late.
  useEffect(() => {
    if (!activeTrade || !data) return;
    const currentSpot = data.metrics.spot;
    const currentPremium = liveLtp ?? getRealCurrentPremium(activeTrade, data.chain, currentSpot);

    const updateJournal = (status: string, exitReason: string, exitPremium: number, exitSpot: number) => {
      const pnlPerLot = exitPremium - activeTrade.entryPremium;
      const totalPnl = pnlPerLot * activeTrade.lotSize;
      const pnlPercent = (pnlPerLot / activeTrade.entryPremium) * 100;
      const durationSec = Math.round((Date.now() - activeTrade.openedAt) / 1000);
      fetch(`/api/trade-journal?limit=200`, { cache: "no-store" }).then(r => r.json()).then(d => {
        const trade = d.trades?.find((t: any) => t.alertId === activeTrade.id);
        if (trade) return fetch(`/api/trade-journal/${trade.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, exitReason, exitPremium, exitSpot, pnlPerLot, totalPnl, pnlPercent, durationSec }) });
        console.warn("[journal] no matching OPEN entry found to close for alertId", activeTrade.id);
        toast.error("Trade Journal was never updated", { description: "This trade's entry was never saved to the journal in the first place, so there's nothing to close.", duration: 8000 });
        return null;
      }).catch(err => { console.error("[journal] exit update failed:", err); toast.error("Trade journal update failed to save", { description: String(err.message || err), duration: 8000 }); });
    };

    // End-of-day square-off at 3:15 PM IST — 15 minutes before NSE/BSE close
    // (3:30 PM), to get out ahead of closing-time liquidity/volatility
    // rather than holding an option position into the final minutes.
    // Shared with market-hours.ts's isPastNewEntryCutoff (used by the
    // alert engine + background watcher to stop firing NEW trades from
    // this same point onward) so both rules always agree on the exact
    // cutoff instead of two copies that could silently drift apart.
    if (isPastNewEntryCutoff()) {
      const action = activeTrade.action, strike = activeTrade.strike, price = currentPremium;
      queueMicrotask(() => {
        toast(`EOD square-off: ${action} ${strike}`, { description: `Auto-closed at 3:15 PM IST at ~${price.toFixed(0)}`, duration: 8000 });
        updateJournal("EOD_SQUAREOFF", `Auto-exited at 3:15 PM IST end-of-day square-off, premium ${price.toFixed(0)}`, price, currentSpot);
        sendTelegramExit("⏰", `EOD square-off: ${action} ${strike}`, `Auto-closed at 3:15 PM IST at ~₹${price.toFixed(0)}`);
        notifyDesktop(`EOD square-off: ${action} ${strike}`, `Auto-closed at ~₹${price.toFixed(0)}`);
        setActiveTrade(null);
      });
      return;
    }

    // Breakeven SL trail — once the trade has covered 50% of the distance
    // to Target 1, move the stop-loss up to entry. This locks in "can't
    // lose money on this trade anymore" the moment it's shown real promise,
    // instead of letting a healthy unrealized gain round-trip all the way
    // back down to the original (wider) stop. One-directional: once moved,
    // it never moves back down even if price pulls back below the halfway
    // mark again.
    if (!activeTrade.slMovedToBreakeven) {
      const halfwayToTarget = activeTrade.entryPremium + 0.5 * (activeTrade.target1Premium - activeTrade.entryPremium);
      if (currentPremium >= halfwayToTarget) {
        const action = activeTrade.action, strike = activeTrade.strike, entryPremium = activeTrade.entryPremium;
        queueMicrotask(() => { toast(`SL moved to breakeven on ${action} ${strike}`, { description: `50% of target reached — SL now at entry (₹${entryPremium})`, duration: 6000 }); });
        setActiveTrade(prev => prev ? { ...prev, stopLossPremium: prev.entryPremium, slMovedToBreakeven: true } : prev);
        return; // re-evaluate SL/target next tick against the now-updated SL
      }
    }

    if (currentPremium <= activeTrade.stopLossPremium) {
      const action = activeTrade.action, strike = activeTrade.strike, price = currentPremium;
      const wasBreakeven = activeTrade.slMovedToBreakeven;
      queueMicrotask(() => { toast.error(wasBreakeven ? `Breakeven SL hit on ${action} ${strike}` : `SL hit on ${action} ${strike}`, { description: `Exited at ~${price.toFixed(0)}${wasBreakeven ? " (breakeven — no loss)" : " (loss)"}`, duration: 8000 }); updateJournal(wasBreakeven ? "SL_HIT" : "SL_HIT", wasBreakeven ? `Breakeven stop hit at premium ${price.toFixed(0)} (SL had trailed to entry after 50% of target)` : `Stop loss hit at premium ${price.toFixed(0)}`, price, currentSpot); sendTelegramExit(wasBreakeven ? "⚪" : "🔻", wasBreakeven ? `Breakeven SL hit: ${action} ${strike}` : `SL hit: ${action} ${strike}`, `Exited at ~₹${price.toFixed(0)}${wasBreakeven ? " (breakeven — no loss)" : " (loss)"}`); notifyDesktop(wasBreakeven ? `Breakeven SL hit: ${action} ${strike}` : `SL hit: ${action} ${strike}`, `Exited at ~₹${price.toFixed(0)}`); setActiveTrade(null); });
    } else if (currentPremium >= activeTrade.target1Premium) {
      // Target 1 is a fixed 1:2 risk:reward off the real SL (see
      // pickTradeLevels in yahoo-adapter.ts) — every trade that fires is
      // designed to exit right here, not run further hoping for T2/T3.
      const action = activeTrade.action, strike = activeTrade.strike, price = currentPremium;
      queueMicrotask(() => { toast.success(`Target 1 hit on ${action} ${strike}! (1:2 RR)`, { description: `Exited at ~${price.toFixed(0)}`, duration: 8000 }); updateJournal("TARGET1_HIT", `Target 1 hit at premium ${price.toFixed(0)} (1:2 risk:reward)`, price, currentSpot); sendTelegramExit("🎯", `Target hit: ${action} ${strike}`, `Exited at ~₹${price.toFixed(0)} (1:2 RR)`); notifyDesktop(`Target hit: ${action} ${strike}`, `Exited at ~₹${price.toFixed(0)} (1:2 RR)`); setActiveTrade(null); });
    }
  }, [data, activeTrade, liveLtp, sendTelegramExit, notifyDesktop]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "r" || e.key === "R") handleRefresh(); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [handleRefresh]);

  const intervalLabel = refreshIntervalSec >= 60 ? `${Math.floor(refreshIntervalSec / 60)} min` : `${refreshIntervalSec} sec`;

  return (
    <div className="min-h-screen bg-[#0a0e14] flex flex-col">
      <AlertBanner alert={lastAlert} onDismiss={() => setLastAlert(null)} soundEnabled={alertConfig.soundEnabled} />
      <SentimentHeader
        symbol={symbol} onSymbolChange={handleSymbolChange} expiry={expiry} onExpiryChange={handleExpiryChange} expiryOptions={expiryOptions} hasActiveTrade={!!activeTrade} sentiment={data?.sentiment ?? "NEUTRAL"} updatedAt={data?.metrics.updatedAt ?? new Date().toISOString()}
        onRefresh={handleRefresh} isRefreshing={isFetching} autoRefresh={autoRefresh} onToggleAuto={() => setAutoRefresh(v => !v)}
        alertConfig={alertConfig} onAlertConfigChange={setAlertConfig} onPreviewSound={previewSound}
        lastAlert={lastAlert} onDismissAlert={() => setLastAlert(null)} tradesToday={tradesToday}
        refreshIntervalSec={refreshIntervalSec} onRefreshIntervalChange={handleIntervalChange}
        brokerConfigured={brokerConfigured}
        onBrokerConfigChanged={() => setBrokerCheckNonce(n => n + 1)}
        dataSource={dataSource} onDataSourceChange={setDataSource} brokerProvider={brokerProvider}
      />

      <BackgroundWatchStrip activeSymbol={symbol} />

      {dataSource === "broker" && !brokerConfigured ? (
        <NoDataBanner variant="not-configured" />
      ) : isError ? (
        <NoDataBanner variant="error" message={error instanceof Error ? error.message : undefined} onRetry={handleRefresh} isRetrying={isFetching} />
      ) : isLoading || !data ? (
        <div className="flex-1 flex items-center justify-center"><div className="flex flex-col items-center gap-3 text-slate-400"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /><p className="text-sm">Loading real option chain data…</p></div></div>
      ) : (() => {
        const { metrics: m, greeks, signals, overallSignal, recommendation: liveRecommendation, chain, history } = data;
        const isSignalLocked = data.signalStability.isLocked;
        const frozenKey = `${symbol}-${data.signalStability.currentAction}`;
        const useFrozen = isSignalLocked && frozenRec?.key === frozenKey;
        const recommendation: TradeRecommendation = useFrozen
          ? { ...liveRecommendation, strike: frozenRec.rec.strike, optionType: frozenRec.rec.optionType, entry: frozenRec.rec.entry, stopLoss: frozenRec.rec.stopLoss, target1: frozenRec.rec.target1, target2: frozenRec.rec.target2, target3: frozenRec.rec.target3, expiry: frozenRec.rec.expiry }
          : liveRecommendation;
        return (
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-5 space-y-5">
        {dataSource === "nse" && (
          <div className="rounded-md border border-amber-700/40 bg-amber-950/20 px-4 py-2 text-[12px] text-amber-300/90 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
            <span><strong>View only.</strong> Spot price & VIX are real (Yahoo Finance), but OI/PCR/Max Pain here are estimated, not from a real option chain. Trade alerts are disabled in this mode — switch to Broker for real OI data + alerts.</span>
          </div>
        )}
        <Tabs value={mainView} onValueChange={v => setMainView(v as "overview" | "chain")}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <TabsList className="bg-[#0f1620] border border-[#1c2530]">
              <TabsTrigger value="overview" className="data-[state=active]:bg-amber-500/10 data-[state=active]:text-amber-400 text-slate-400">Dashboard</TabsTrigger>
              <TabsTrigger value="chain" className="data-[state=active]:bg-amber-500/10 data-[state=active]:text-amber-400 text-slate-400">Option Chain</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              <PerformanceDashboard symbol={symbol} />
              <TelegramAlertsDialog />
            </div>
          </div>
          <TabsContent value="overview" className="space-y-5 mt-4">
        {/* Metrics grid */}
        <section>
          <SectionTitle title="Key Metrics" subtitle="Real-time PCR, VIX, smart flow & Greeks-based market read" />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2 mt-3">
            <MetricCard label={`${m.symbol} Spot`} value={smoothedSpot.toFixed(2)} sublabel={<span className={m.spot >= m.prevSpot ? "text-emerald-400" : "text-rose-400"}>{m.spot >= m.prevSpot ? "▲" : "▼"} {Math.abs(m.spot - m.prevSpot).toFixed(2)} ({(((m.spot - m.prevSpot) / m.prevSpot) * 100).toFixed(2)}%)</span>} accent={m.spot >= m.prevSpot ? "bull" : "bear"} />
            <MetricCard label="PCR" value={m.pcr.toFixed(2)} sublabel={m.pcr > 1.2 ? "Oversold / Bullish bias" : m.pcr < 0.8 ? "Overbought / Bearish bias" : "Balanced range"} accent={m.pcr > 1.2 ? "bull" : m.pcr < 0.8 ? "bear" : "neutral"} />
            <MetricCard label="India VIX" value={<span>{m.indiaVix.toFixed(2)} <span className="text-xs text-slate-500 ml-1">{m.vixStatus}</span></span>} sublabel={m.indiaVix > 18 ? "High volatility — caution" : m.indiaVix < 11 ? "Low volatility — complacency" : "Normal volatility regime"} accent={m.indiaVix > 18 ? "warning" : m.indiaVix < 11 ? "info" : "neutral"} />
            <MetricCard label="Smart Flow" value={<span>{m.smartFlowAvailable ? `${m.smartFlow > 0 ? "+" : ""}${m.smartFlow}` : "…"}</span>} sublabel={!m.smartFlowAvailable ? "Building up — needs one more refresh" : m.smartFlow > 15 ? "Put writing — bullish money" : m.smartFlow < -15 ? "Call writing — bearish money" : "Balanced OI flow"} accent={!m.smartFlowAvailable ? "neutral" : m.smartFlow > 15 ? "bull" : m.smartFlow < -15 ? "bear" : "neutral"} />
            <MetricCard label="Max Pain" value={m.maxPain} sublabel={`Spot vs MP: ${m.spot > m.maxPain ? "+" : ""}${(m.spot - m.maxPain).toFixed(0)}`} accent="info" />
            <MetricCard label="Pain Shift" value={<span>{m.painShift > 0 ? "+" : ""}{m.painShift}</span>} sublabel={m.painShift > 0 ? "Max pain rising — bullish" : m.painShift < 0 ? "Max pain falling — bearish" : "No shift"} accent={m.painShift > 0 ? "bull" : m.painShift < 0 ? "bear" : "neutral"} />
            <MetricCard label="GEX" value={<span>{m.gex > 0 ? "+" : ""}{m.gex}M</span>} sublabel={m.gex > 0 ? "Dealer long gamma — stable" : "Dealer short gamma — volatile"} accent={m.gex > 0 ? "bull" : "bear"} />
            <MetricCard label="Gamma Flip" value={m.gammaFlip} sublabel="Volatility trigger level" accent="warning" />
            <MetricCard label="Trend Score" value={<span>{m.trendScore}<span className="text-xs text-slate-500 ml-1">/100</span></span>} sublabel={m.trendScore > 70 ? "Strong uptrend" : m.trendScore < 30 ? "Strong downtrend" : "Range-bound"} accent={m.trendScore > 70 ? "bull" : m.trendScore < 30 ? "bear" : "neutral"} />
            <MetricCard label="Bull Probability" value={`${m.bullProb}%`} sublabel="Aggregated from signals & flows" accent="bull" />
            <MetricCard label="Bear Probability" value={`${m.bearProb}%`} sublabel="Inverse of bull probability" accent="bear" />
            <MetricCard label="BankNifty" value={<span>{m.bankNiftyScore}<span className="text-xs text-slate-500 ml-1">/100</span></span>} sublabel={m.bankNiftyTrend} accent={m.bankNiftyScore > 60 ? "bull" : m.bankNiftyScore < 40 ? "bear" : "neutral"} />
            <MetricCard label="Support" value={<span className="text-lg font-mono">{m.support.map((s, i) => <span key={i}>{i > 0 && " · "}{s.level}<span className="text-slate-500 text-[10px] ml-0.5">({s.strength})</span></span>)}</span>} sublabel="High-OI put strikes below spot" accent="bull" />
            <MetricCard label="Resistance" value={<span className="text-lg font-mono">{m.resistance.map((s, i) => <span key={i}>{i > 0 && " · "}{s.level}<span className="text-slate-500 text-[10px] ml-0.5">({s.strength})</span></span>)}</span>} sublabel="High-OI call strikes above spot" accent="bear" />
            <MetricCard label="Regime" value={<span className="text-lg font-bold">{m.regime}</span>} sublabel="Market structure classification" accent={m.regime === "TRENDING UP" ? "bull" : m.regime === "TRENDING DOWN" ? "bear" : m.regime === "VOLATILE" ? "warning" : "neutral"} />
            <MetricCard label="Last Updated" value={<span className="text-lg font-mono">{new Date(m.updatedAt).toLocaleTimeString("en-IN", { hour12: false })}</span>} sublabel={isFetching ? "Refreshing…" : `Auto-refresh every ${intervalLabel}`} accent="info" />
          </div>
        </section>

        {/* Active Trade(s) — everything currently open, in one place: the
            actively-viewed symbol's trade (rich, live-tick-tracked panel)
            plus any other symbols' trades the background watcher has
            fired, together under one section rather than split across
            the dashboard. */}
        {(activeTrade || otherOpenTrades.length > 0) && (
          <section>
            <SectionTitle
              title={otherOpenTrades.length > 0 ? `Active Trades (${(activeTrade ? 1 : 0) + otherOpenTrades.length})` : "Active Trade"}
              subtitle="Live P&L tracking — auto-exits when SL or Target 1 (fixed 1:2 RR) is hit"
            />
            <div className="mt-3 space-y-3">
              {activeTrade && data && (
                <ActiveTradePanel
                  trade={activeTrade}
                  currentPremium={smoothedPremium}
                  currentSpot={smoothedSpot}
                  isLive={liveLtp !== null}
                  journalStatus={activeTrade.journalStatus}
                  onRetryJournal={() => {
                    setActiveTrade(prev => prev ? { ...prev, journalStatus: "saving" } : prev);
                    saveTradeToJournal({ id: activeTrade.id, symbol: activeTrade.symbol, action: activeTrade.action, strike: activeTrade.strike, entry: activeTrade.entryPremium, stopLoss: activeTrade.stopLossPremium, target1: activeTrade.target1Premium, target2: activeTrade.target2Premium, target3: activeTrade.target3Premium, confidence: activeTrade.confidence, entrySpot: activeTrade.entrySpot, sentiment: activeTrade.sentiment, rationale: activeTrade.rationale, regime: activeTrade.regime });
                  }}
                  onClose={() => {
                  const exitSpot = data.metrics.spot;
                  const exitPremium = getRealCurrentPremium(activeTrade, data.chain, exitSpot);
                  const pnlPerLot = exitPremium - activeTrade.entryPremium; const totalPnl = pnlPerLot * activeTrade.lotSize; const pnlPercent = (pnlPerLot / activeTrade.entryPremium) * 100; const durationSec = Math.round((Date.now() - activeTrade.openedAt) / 1000);
                  toast("Trade closed manually", { description: `Exited at ~${exitPremium.toFixed(0)} · P&L ${totalPnl >= 0 ? "+" : "−"}₹${Math.abs(totalPnl).toFixed(0)}` });
                  fetch(`/api/trade-journal?limit=200`, { cache: "no-store" }).then(r => r.json()).then(d => {
                    const trade = d.trades?.find((t: any) => t.alertId === activeTrade.id);
                    if (trade) return fetch(`/api/trade-journal/${trade.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "MANUAL_CLOSE", exitReason: "User manually closed the trade", exitPremium, exitSpot, pnlPerLot, totalPnl, pnlPercent, durationSec }) });
                    // The trade never actually got an OPEN row in the journal (the
                    // create POST must have failed and no retry succeeded) — say so
                    // explicitly instead of quietly doing nothing, which is exactly
                    // the "trade ran but journal shows nothing" confusion.
                    console.warn("[journal] no matching OPEN entry found to close for alertId", activeTrade.id);
                    toast.error("Trade Journal was never updated", { description: "This trade's entry was never saved to the journal in the first place, so there's nothing to close.", duration: 8000 });
                    return null;
                  }).catch(err => { console.error("[journal] manual close failed:", err); toast.error("Trade journal update failed to save", { description: String(err.message || err), duration: 8000 }); });
                  setActiveTrade(null);
                }} />
              )}

              {/* Other open trades — fired in the background by the
                  multi-symbol watcher for symbols other than the one
                  currently shown above. Read-only here; close them from
                  the Trade Journal table below. */}
              {otherOpenTrades.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {otherOpenTrades.map(t => {
                    const isBull = t.action === "BUY CE";
                    const ltp = watchLtpBySymbol[t.symbol];
                    const pnlPerLotNow = ltp != null ? ltp - t.entryPremium : null;
                    return (
                      <div key={t.id} className="rounded-lg border border-cyan-800/40 bg-[#0f1620] p-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                            {isBull ? <TrendingUp className="h-3.5 w-3.5 text-emerald-400" /> : <TrendingDown className="h-3.5 w-3.5 text-rose-400" />}
                            {t.symbol} {t.strike} {t.optionType}
                          </span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-700/40">
                          {watchTickLiveBySymbol[t.symbol] ? "● live tick" : "background"}
                        </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
                          <div><span className="text-slate-500">Entry</span><div className="text-slate-300">₹{t.entryPremium.toFixed(2)}</div></div>
                          <div><span className="text-slate-500">LTP</span><div className={cn(ltp == null ? "text-slate-500" : pnlPerLotNow! >= 0 ? "text-emerald-400" : "text-rose-400")}>{ltp != null ? `₹${ltp.toFixed(2)}` : "—"}</div></div>
                          <div><span className="text-slate-500">SL / Target</span><div className="text-slate-300">{t.stopLoss.toFixed(0)} / {t.target1.toFixed(0)}</div></div>
                        </div>
                        <div className="mt-1.5 text-[10px] text-slate-500">{t.confidence}% confidence · opened {new Date(t.openedAt).toLocaleTimeString("en-IN", { hour12: false })}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Signal Stability + Multi-Timeframe */}
        <section>
          <SectionTitle title="Multi-Timeframe Signal Analysis" subtitle="RSI, EMA cross, VWAP, PCR trend & smart money — combined per timeframe" />
          <div className="mt-3"><SignalStabilityIndicator stability={data.signalStability} overallAction={overallSignal.signal} confidence={overallSignal.confidence} refreshIntervalSec={refreshIntervalSec} /></div>
          <Tabs value={activeTab} onValueChange={v => setActiveTab(v as Timeframe)} className="mt-3">
            <TabsList className="bg-[#0f1620] border border-[#1c2530]">
              <TabsTrigger value="5min" className="data-[state=active]:bg-amber-500/10 data-[state=active]:text-amber-400 text-slate-400">5 Min</TabsTrigger>
              <TabsTrigger value="15min" className="data-[state=active]:bg-amber-500/10 data-[state=active]:text-amber-400 text-slate-400">15 Min</TabsTrigger>
              <TabsTrigger value="30min" className="data-[state=active]:bg-amber-500/10 data-[state=active]:text-amber-400 text-slate-400">30 Min</TabsTrigger>
              <TabsTrigger value="consensus" className="data-[state=active]:bg-amber-500/10 data-[state=active]:text-amber-400 text-slate-400">Consensus</TabsTrigger>
            </TabsList>
            <TabsContent value="5min" className="mt-3"><SignalCard signal={signals["5min"]} /></TabsContent>
            <TabsContent value="15min" className="mt-3"><SignalCard signal={signals["15min"]} /></TabsContent>
            <TabsContent value="30min" className="mt-3"><SignalCard signal={signals["30min"]} /></TabsContent>
            <TabsContent value="consensus" className="mt-3"><SignalCard signal={overallSignal} isOverall /></TabsContent>
          </Tabs>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4">
            <CompactSignal tf="5min" signal={signals["5min"]} />
            <CompactSignal tf="15min" signal={signals["15min"]} />
            <CompactSignal tf="30min" signal={signals["30min"]} />
            <CompactSignal tf="consensus" signal={overallSignal} highlight />
          </div>
        </section>

        {/* Suggested Trade + Alert Readiness */}
        <section>
          <SectionTitle title="Suggested Trade" subtitle="Auto-generated from the consensus signal — risk-managed entry, SL & targets" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3">
            <SuggestedTrade trade={recommendation} spot={m.spot} symbol={m.symbol} isLocked={isSignalLocked} minRiskReward={alertConfig.minRiskReward} />
            <AlertReadinessCard
              action={overallSignal.signal}
              confidence={overallSignal.confidence}
              riskReward={recommendation.riskReward}
              lowLiquidity={recommendation.lowLiquidity}
              isLocked={isSignalLocked}
              tf5={signals["5min"].signal} tf15={signals["15min"].signal} tf30={signals["30min"].signal}
              hasActiveTrade={!!activeTrade}
              alertsAllowed={!!data.alertsAllowed}
              config={alertConfig}
            />
          </div>
        </section>

        {/* ATM Greeks + History + Candle Pattern */}
        <section>
          <SectionTitle title="ATM Greeks & Live Trend" subtitle="Delta/Gamma/Theta/Vega for the at-the-money strike + sparklines + candlestick pattern" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-3">
            <AtmGreeks greeks={greeks} atmStrike={m.atmStrike} />
            <HistoryPanel history={history} />
            <CandlePatternCard pattern={data.candlePattern} />
          </div>
        </section>
          </TabsContent>

          <TabsContent value="chain" className="mt-4 space-y-5">
            {/* Option Chain Table */}
            <section>
              <OptionChainTable rows={chain} spot={m.spot} />
            </section>

            {/* Trade Journal */}
            <section>
              <SectionTitle title="Trade Journal" subtitle="Auto-records every trade signal the system generates — track win rate + P&L over time" />
              <div className="mt-3"><TradeJournalPanel currentSpot={data?.metrics.spot} onExternalClose={(alertId) => { setActiveTrade(prev => (prev && prev.id === alertId) ? null : prev); }} activeTradeLtp={activeTrade ? { alertId: activeTrade.id, ltp: realCurrentPremium } : null} watchLtpBySymbol={watchLtpBySymbol} /></div>
            </section>
          </TabsContent>
        </Tabs>
        </main>
        );
      })()}

      <footer className="mt-6 border-t border-[#1c2530] bg-[#0c1119] py-4">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 text-center text-[11px] text-slate-600">
          Option Chain Pulse · Real-time analyzer with PCR, India VIX, smart money flow, GEX & multi-timeframe (5m / 15m / 30m) trade signals · Trade alerts only fire on real broker-sourced data — not investment advice
        </div>
      </footer>
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return <div><h2 className="text-base font-semibold text-slate-200 tracking-tight">{title}</h2><p className="text-[12px] text-slate-500 mt-0.5">{subtitle}</p></div>;
}

function CompactSignal({ tf, signal, highlight = false }: { tf: string; signal: { signal: string; confidence: number; trend: string }; highlight?: boolean }) {
  const isBull = signal.signal === "BUY CE"; const isBear = signal.signal === "BUY PE";
  const color = isBull ? "emerald" : isBear ? "rose" : "amber";
  const cm: Record<string, string> = { emerald: "border-emerald-700/40 bg-emerald-500/5 text-emerald-400", rose: "border-rose-700/40 bg-rose-500/5 text-rose-400", amber: "border-amber-700/40 bg-amber-500/5 text-amber-400" };
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${highlight ? "ring-1 ring-amber-700/30 " + cm[color] : cm[color]}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-slate-400">{tf === "consensus" ? "Consensus" : tf}</span>
        <span className={`text-[10px] font-mono ${signal.trend === "UP" ? "text-emerald-400" : signal.trend === "DOWN" ? "text-rose-400" : "text-amber-400"}`}>{signal.trend}</span>
      </div>
      <div className="font-bold text-base mt-0.5">{signal.signal}</div>
      <div className="text-[10px] text-slate-500 font-mono">{signal.confidence}% confidence</div>
    </div>
  );
}
