"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  TrendingDown,
  Target,
  Shield,
  Crosshair,
  CircleDollarSign,
  Clock,
} from "lucide-react";
import { TradeRecommendation } from "@/lib/types";
import { cn } from "@/lib/utils";

interface SuggestedTradeProps {
  trade: TradeRecommendation;
  spot: number;
  symbol: string;
  isLocked: boolean;
  minRiskReward?: number;
}

export function SuggestedTrade({ trade, spot, symbol, isLocked, minRiskReward = 1.3 }: SuggestedTradeProps) {
  const isBull = trade.action === "BUY CE";
  const isWait = trade.action === "WAIT" || trade.action === "EXIT";
  const accent = isWait
    ? "amber"
    : isBull
    ? "emerald"
    : "rose";

  const accentMap: Record<string, { bg: string; text: string; border: string }> = {
    emerald: {
      bg: "bg-emerald-500/10",
      text: "text-emerald-400",
      border: "border-emerald-700/40",
    },
    rose: {
      bg: "bg-rose-500/10",
      text: "text-rose-400",
      border: "border-rose-700/40",
    },
    amber: {
      bg: "bg-amber-500/10",
      text: "text-amber-400",
      border: "border-amber-700/40",
    },
  };
  const a = accentMap[accent];

  if (isWait) {
    return (
      <Card className="bg-[#0f1620] border-[#1c2530] p-4 flex flex-col items-center justify-center text-center min-h-[180px]">
        <div className="h-11 w-11 rounded-lg bg-amber-500/10 border border-amber-700/40 flex items-center justify-center mb-3">
          <Clock className="h-5 w-5 text-amber-400" />
        </div>
        <h2 className="text-sm font-semibold text-slate-300">No trade right now</h2>
        <p className="text-xs text-slate-500 mt-1 max-w-xs">
          Waiting for a directional signal to lock in. Nothing to show here until then — check Signal Stability above for progress.
        </p>
      </Card>
    );
  }

  const ActionIcon = isBull ? TrendingUp : isWait ? Clock : TrendingDown;

  return (
    <Card className="bg-[#0a0e14] border-[#1c2530] p-3">
      {/* Title row */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "h-11 w-11 rounded-lg flex items-center justify-center border",
              a.bg,
              a.border
            )}
          >
            <ActionIcon className={cn("h-6 w-6", a.text)} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] uppercase tracking-wider text-slate-500">
                Suggested Trade
              </span>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] font-mono",
                  a.bg,
                  a.text,
                  a.border
                )}
              >
                {trade.action}
              </Badge>
              {!isWait && (
                <Badge variant="outline" className={cn("text-[9px] font-mono", isLocked ? "bg-emerald-500/10 text-emerald-400 border-emerald-700/40" : "bg-slate-700/20 text-slate-400 border-slate-700/40")}>
                  {isLocked ? "🔒 Locked — numbers fixed" : "⏳ Still forming — may shift"}
                </Badge>
              )}
            </div>
            <h2 className="text-xl font-bold text-slate-100 font-mono mt-0.5">
              {trade.action === "WAIT"
                ? "No trade — wait for confirmation"
                : `${trade.action} ${trade.strike} ${trade.optionType}`}
              <span className="ml-2 text-xs font-normal text-slate-500">
                {symbol} · Exp {trade.expiry}
              </span>
            </h2>
          </div>
        </div>

        <div className="text-right">
          <div
            className={cn(
              "text-3xl font-mono font-bold",
              trade.confidence >= 75
                ? "text-emerald-400"
                : trade.confidence >= 55
                ? "text-amber-400"
                : "text-rose-400"
            )}
          >
            {trade.confidence}%
          </div>
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">
            Confidence
          </div>
        </div>
      </div>

      {/* Levels grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 mb-3">
        <LevelBox
          icon={<CircleDollarSign className="h-4 w-4" />}
          label="Entry"
          value={trade.entry}
          sub={`Spot ${spot} · LTP ${trade.ltp !== undefined ? trade.ltp : "N/A"}`}
          color="text-cyan-300"
          border="border-cyan-700/30"
          bg="bg-cyan-500/5"
        />
        <LevelBox
          icon={<Shield className="h-4 w-4" />}
          label="Stop Loss"
          value={trade.stopLoss}
          sub={`-${(((trade.entry - trade.stopLoss) / trade.entry) * 100).toFixed(
            1
          )}%`}
          color="text-rose-400"
          border="border-rose-700/30"
          bg="bg-rose-500/5"
        />
        <LevelBox
          icon={<Target className="h-4 w-4" />}
          label="Target 1 (exit · 1:2 RR)"
          value={trade.target1}
          sub={`+${(((trade.target1 - trade.entry) / trade.entry) * 100).toFixed(
            1
          )}%`}
          color="text-emerald-400"
          border="border-emerald-600/50"
          bg="bg-emerald-500/10"
        />
        <LevelBox
          icon={<Target className="h-4 w-4" />}
          label="Target 2 (ref only)"
          value={trade.target2}
          sub={`+${(((trade.target2 - trade.entry) / trade.entry) * 100).toFixed(
            1
          )}%`}
          color="text-emerald-400"
          border="border-emerald-700/30"
          bg="bg-emerald-500/5"
        />
        <LevelBox
          icon={<Target className="h-4 w-4" />}
          label="Target 3 (ref only)"
          value={trade.target3}
          sub={`+${(((trade.target3 - trade.entry) / trade.entry) * 100).toFixed(
            1
          )}%`}
          color="text-emerald-400"
          border="border-emerald-700/30"
          bg="bg-emerald-500/5"
        />
      </div>

      {/* R:R + rationale */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        <div
          className={cn(
            "rounded-lg border px-4 py-3 flex items-center justify-between",
            a.bg,
            a.border
          )}
        >
          <div className="flex items-center gap-2">
            <Crosshair className={cn("h-4 w-4", a.text)} />
            <span className="text-xs uppercase tracking-wider text-slate-400">
              Risk : Reward
            </span>
          </div>
          <span className={cn("font-mono text-lg font-bold", a.text)}>
            1 : {trade.riskReward}
          </span>
        </div>

        <div className="lg:col-span-3 bg-[#0f1620] border border-[#1c2530] rounded-lg px-4 py-3">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">
            Trade Rationale
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">
            {trade.rationale}
          </p>
        </div>
      </div>

      {trade.lowLiquidity && !isWait && (
        <div className="mt-3 rounded-md border border-amber-700/40 bg-amber-950/20 px-3 py-2 flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
          <p className="text-[11px] text-amber-300/90">
            <strong>Low liquidity</strong> at this strike today ({trade.volume ?? "N/A"} contracts traded) — spreads may be wide and exits harder. Consider a more liquid strike or waiting.
          </p>
        </div>
      )}

      {!isWait && trade.riskReward < minRiskReward && (
        <div className="mt-3 rounded-md border border-amber-700/40 bg-amber-950/20 px-3 py-2 flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
          <p className="text-[11px] text-amber-300/90">
            <strong>Poor risk:reward</strong> (1:{trade.riskReward}) — shown for information only, this would not pass the alert filter (needs 1:{minRiskReward.toFixed(1)}+ with your current settings). Often means the nearest resistance/support is too close by for a good payoff right now.
          </p>
        </div>
      )}

      {/* Disclaimer */}
      <div className="mt-3 text-[10px] text-slate-600 leading-relaxed">
        ⚠ Not investment advice. Options trading involves substantial risk of
        loss. Always do your own research and consult a SEBI-registered
        advisor before trading.
      </div>
    </Card>
  );
}

function LevelBox({
  icon,
  label,
  value,
  sub,
  color,
  border,
  bg,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub: string;
  color: string;
  border: string;
  bg: string;
}) {
  return (
    <div className={cn("rounded-lg border px-2.5 py-2", bg, border)}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className={color}>{icon}</span>
        <span className="text-[10px] uppercase tracking-wider text-slate-500">
          {label}
        </span>
      </div>
      <div className={cn("font-mono text-xl font-bold", color)}>{value}</div>
      <div className="text-[10px] text-slate-500 font-mono">{sub}</div>
    </div>
  );
}
