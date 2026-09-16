"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Activity, RefreshCw, Zap, Clock } from "lucide-react";
import { Sentiment, Symbol } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AlertManager, AlertConfig, AlertEvent } from "./alert-manager";
import { ApiKeysDialog } from "./api-keys-dialog";
import { HelpDialog } from "./help-dialog";

interface SentimentHeaderProps {
  symbol: Symbol; onSymbolChange: (s: Symbol) => void;
  expiry: string | undefined; onExpiryChange: (e: string | undefined) => void; expiryOptions: { iso: string; label: string }[]; hasActiveTrade: boolean;
  sentiment: Sentiment; updatedAt: string;
  onRefresh: () => void; isRefreshing: boolean;
  autoRefresh: boolean; onToggleAuto: () => void;
  alertConfig: AlertConfig; onAlertConfigChange: (c: AlertConfig) => void;
  onPreviewSound: () => void; lastAlert: AlertEvent | null; onDismissAlert: () => void; tradesToday: number;
  refreshIntervalSec: number; onRefreshIntervalChange: (sec: number) => void;
  brokerConfigured: boolean; onBrokerConfigChanged: () => void;
  dataSource: "nse" | "broker"; onDataSourceChange: (s: "nse" | "broker") => void;
  brokerProvider: string | null;
}

const SENTIMENT_STYLE: Record<Sentiment, { bg: string; text: string; dot: string; label: string }> = {
  "STRONG BULLISH": { bg: "bg-emerald-500/10 border-emerald-600/40", text: "text-emerald-400", dot: "bg-emerald-500 animate-pulse", label: "STRONG BULLISH" },
  BULLISH: { bg: "bg-emerald-500/5 border-emerald-700/30", text: "text-emerald-300", dot: "bg-emerald-400", label: "BULLISH" },
  NEUTRAL: { bg: "bg-amber-500/5 border-amber-700/30", text: "text-amber-300", dot: "bg-amber-400", label: "NEUTRAL" },
  BEARISH: { bg: "bg-rose-500/5 border-rose-700/30", text: "text-rose-300", dot: "bg-rose-400", label: "BEARISH" },
  "STRONG BEARISH": { bg: "bg-rose-500/10 border-rose-600/40", text: "text-rose-400", dot: "bg-rose-500 animate-pulse", label: "STRONG BEARISH" },
};

export function SentimentHeader({
  symbol, onSymbolChange, expiry, onExpiryChange, expiryOptions, hasActiveTrade, sentiment, updatedAt, onRefresh, isRefreshing, autoRefresh, onToggleAuto,
  alertConfig, onAlertConfigChange, onPreviewSound, lastAlert, onDismissAlert, tradesToday,
  refreshIntervalSec, onRefreshIntervalChange,
  brokerConfigured, onBrokerConfigChanged,
  dataSource, onDataSourceChange, brokerProvider,
}: SentimentHeaderProps) {
  const s = SENTIMENT_STYLE[sentiment];
  const time = new Date(updatedAt).toLocaleTimeString("en-IN", { hour12: false });
  const brokerLabel = brokerProvider ? brokerProvider.toUpperCase() : "BROKER";

  // Ticks every second so "Updated Xs ago" visibly counts up — concrete
  // proof the data refresh cycle is actually running, independent of
  // whether the underlying numbers happened to change.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secsAgo = Math.max(0, Math.round((nowTick - new Date(updatedAt).getTime()) / 1000));
  const agoLabel = secsAgo < 60 ? `${secsAgo}s ago` : `${Math.floor(secsAgo / 60)}m ${secsAgo % 60}s ago`;
  const intervalLabel = refreshIntervalSec >= 60 ? `${Math.floor(refreshIntervalSec / 60)} min` : `${refreshIntervalSec} sec`;

  return (
    <header className="bg-[#0c1119] border-b border-[#1c2530]">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-900/30">
              <Activity className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-100 leading-none">Option Chain Pulse</h1>
              <p className="text-[11px] text-slate-500 mt-0.5">PCR · India VIX · Smart Money · Multi-Timeframe Signals</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Select value={symbol} onValueChange={(v) => onSymbolChange(v as Symbol)}>
              <SelectTrigger className="w-[140px] bg-[#0f1620] border-[#1c2530] text-slate-100"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[#0f1620] border-[#1c2530]">
                <SelectItem value="NIFTY">NIFTY 50</SelectItem>
                <SelectItem value="BANKNIFTY">BANK NIFTY</SelectItem>
                <SelectItem value="SENSEX">SENSEX</SelectItem>
              </SelectContent>
            </Select>

            <Select value={expiry ?? "__default__"} onValueChange={(v) => onExpiryChange(v === "__default__" ? undefined : v)} disabled={hasActiveTrade}>
              <SelectTrigger className="w-[150px] bg-[#0f1620] border-[#1c2530] text-slate-100 disabled:opacity-50" title={hasActiveTrade ? "Can't change expiry while a trade is active — its live price tracking depends on the currently-selected expiry's chain" : "Choose which expiry's option chain to trade — defaults to the nearest real expiry"}><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[#0f1620] border-[#1c2530]">
                <SelectItem value="__default__">Nearest expiry</SelectItem>
                {expiryOptions.map(o => <SelectItem key={o.iso} value={o.iso}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>

            {/* NSE (view-only) / Broker (real + alerts) toggle */}
            <div className="flex items-center bg-[#0f1620] border border-[#1c2530] rounded-md p-0.5 h-9">
              <button onClick={() => onDataSourceChange("nse")} className={cn("px-2.5 h-8 rounded text-[11px] font-semibold transition-colors flex items-center gap-1", dataSource === "nse" ? "bg-amber-600/20 text-amber-400" : "text-slate-500 hover:text-slate-300")} title="Real spot/VIX (Yahoo Finance), estimated option chain — view only, no trade alerts">
                <span className={cn("h-1.5 w-1.5 rounded-full", dataSource === "nse" ? "bg-amber-500 animate-pulse" : "bg-slate-600")} />NSE (VIEW)
              </button>
              <button onClick={() => onDataSourceChange("broker")} disabled={!brokerConfigured} className={cn("px-2.5 h-8 rounded text-[11px] font-semibold transition-colors flex items-center gap-1", dataSource === "broker" ? "bg-violet-600/20 text-violet-400" : brokerConfigured ? "text-slate-400 hover:text-slate-200" : "text-slate-700 cursor-not-allowed")} title={brokerConfigured ? `Real broker API (${brokerLabel}) — 100% real data, trade alerts enabled` : "Add API keys first (click API Keys button)"}>
                <span className={cn("h-1.5 w-1.5 rounded-full", dataSource === "broker" ? "bg-violet-500 animate-pulse" : brokerConfigured ? "bg-violet-600" : "bg-slate-700")} />{dataSource === "broker" ? brokerLabel : "BROKER"}
              </button>
            </div>

            <ApiKeysDialog onConfigChanged={onBrokerConfigChanged} />

            <AlertManager config={alertConfig} onConfigChange={onAlertConfigChange} onPreviewSound={onPreviewSound} lastAlert={lastAlert} onDismissAlert={onDismissAlert} tradesToday={tradesToday} />

            <Button variant="outline" size="sm" onClick={onToggleAuto} className={cn("bg-[#0f1620] border-[#1c2530] text-slate-300 hover:text-slate-100 hover:bg-[#1a2230]", autoRefresh && "border-emerald-700/50 text-emerald-400 hover:text-emerald-300")}>
              <Zap className="h-3.5 w-3.5 mr-1" />{autoRefresh ? "AUTO ON" : "AUTO OFF"}
            </Button>

            <Select value={String(refreshIntervalSec)} onValueChange={(v) => onRefreshIntervalChange(parseInt(v, 10))} disabled={!autoRefresh}>
              <SelectTrigger className="w-[110px] h-9 bg-[#0f1620] border-[#1c2530] text-slate-300 text-xs" title="Data refresh interval">
                <Clock className="h-3 w-3 mr-1 text-slate-500" /><SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#0f1620] border-[#1c2530]">
                <SelectItem value="5" className="text-xs">Every 5 sec</SelectItem>
                <SelectItem value="15" className="text-xs">Every 15 sec</SelectItem>
                <SelectItem value="30" className="text-xs">Every 30 sec</SelectItem>
                <SelectItem value="60" className="text-xs">Every 1 min</SelectItem>
                <SelectItem value="180" className="text-xs">Every 3 min</SelectItem>
                <SelectItem value="300" className="text-xs">Every 5 min</SelectItem>
                <SelectItem value="600" className="text-xs">Every 10 min</SelectItem>
              </SelectContent>
            </Select>

            <Button variant="outline" size="sm" onClick={onRefresh} disabled={isRefreshing} className="bg-[#0f1620] border-[#1c2530] text-slate-300 hover:text-slate-100 hover:bg-[#1a2230]">
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1", isRefreshing && "animate-spin")} />Refresh
            </Button>

            <HelpDialog />
          </div>
        </div>

        <div className={cn("flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-2.5", s.bg)}>
          <div className="flex items-center gap-3">
            <span className={cn("h-3 w-3 rounded-full", s.dot)} />
            <div>
              <div className={cn("text-sm font-bold tracking-wide", s.text)}>{s.label}</div>
              <div className="text-[11px] text-slate-400">Overall market sentiment</div>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <Badge variant="outline" className={cn("bg-[#0f1620] border-[#1c2530] font-mono", secsAgo > 90 ? "text-amber-400 border-amber-700/40" : "text-slate-300")}>Updated {time} <span className="text-slate-500 ml-1.5">({agoLabel})</span></Badge>
            <span className="text-slate-500 hidden sm:inline">Data refreshes every {intervalLabel} in auto mode</span>
          </div>
        </div>
      </div>
    </header>
  );
}
