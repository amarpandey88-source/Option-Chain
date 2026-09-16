"use client";

import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { Timeframe, TimeframeSignal, TradeAction } from "@/lib/types";
import { cn } from "@/lib/utils";

interface SignalCardProps {
  signal: TimeframeSignal;
  isOverall?: boolean;
}

const ACTION_STYLE: Record<
  TradeAction,
  { bg: string; text: string; border: string; label: string }
> = {
  "BUY CE": {
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-600/50",
    label: "BUY CALL",
  },
  "BUY PE": {
    bg: "bg-rose-500/10",
    text: "text-rose-400",
    border: "border-rose-600/50",
    label: "BUY PUT",
  },
  WAIT: {
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-600/50",
    label: "WAIT",
  },
  EXIT: {
    bg: "bg-orange-500/10",
    text: "text-orange-400",
    border: "border-orange-600/50",
    label: "EXIT",
  },
};

const TF_LABEL: Record<Timeframe, string> = {
  "5min": "5 Minute",
  "15min": "15 Minute",
  "30min": "30 Minute",
};

export function SignalCard({ signal, isOverall = false }: SignalCardProps) {
  const action = ACTION_STYLE[signal.signal];
  const TrendIcon =
    signal.trend === "UP"
      ? TrendingUp
      : signal.trend === "DOWN"
      ? TrendingDown
      : Minus;

  const confidenceColor =
    signal.confidence >= 75
      ? "text-emerald-400"
      : signal.confidence >= 55
      ? "text-amber-400"
      : "text-rose-400";

  return (
    <Card
      className={cn(
        "bg-[#0f1620] border-[#1c2530] p-4 flex flex-col gap-3",
        isOverall && "border-amber-700/50 ring-1 ring-amber-700/20"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendIcon
            className={cn(
              "h-4 w-4",
              signal.trend === "UP"
                ? "text-emerald-400"
                : signal.trend === "DOWN"
                ? "text-rose-400"
                : "text-amber-400"
            )}
          />
          <span
            className={cn(
              "text-sm font-semibold",
              isOverall ? "text-amber-300" : "text-slate-200"
            )}
          >
            {isOverall ? "Consensus" : TF_LABEL[signal.timeframe]}
          </span>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "font-mono text-[10px] border-[#1c2530]",
            signal.trend === "UP"
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-700/40"
              : signal.trend === "DOWN"
              ? "bg-rose-500/10 text-rose-400 border-rose-700/40"
              : "bg-amber-500/10 text-amber-400 border-amber-700/40"
          )}
        >
          {signal.trend}
        </Badge>
      </div>

      {/* Action */}
      <div
        className={cn(
          "rounded-md border px-3 py-2 flex items-center justify-between",
          action.bg,
          action.border
        )}
      >
        <div>
          <div className={cn("text-base font-bold tracking-wide", action.text)}>
            {action.label}
          </div>
          <div className="text-[10px] text-slate-400">Signal</div>
        </div>
        <div className="text-right">
          <div className={cn("text-2xl font-mono font-bold", confidenceColor)}>
            {signal.confidence}%
          </div>
          <div className="text-[10px] text-slate-500">confidence</div>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-[#0a0e14] rounded px-2 py-1.5">
          <div className="text-[10px] uppercase text-slate-500">RSI</div>
          <div
            className={cn(
              "font-mono text-sm font-semibold",
              signal.rsi > 60
                ? "text-emerald-400"
                : signal.rsi < 40
                ? "text-rose-400"
                : "text-slate-300"
            )}
          >
            {signal.rsi}
          </div>
        </div>
        <div className="bg-[#0a0e14] rounded px-2 py-1.5">
          <div className="text-[10px] uppercase text-slate-500">Momentum</div>
          <div
            className={cn(
              "font-mono text-sm font-semibold flex items-center justify-center gap-0.5",
              signal.momentum > 0
                ? "text-emerald-400"
                : signal.momentum < 0
                ? "text-rose-400"
                : "text-slate-300"
            )}
          >
            {signal.momentum > 0 ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : signal.momentum < 0 ? (
              <ArrowDownRight className="h-3 w-3" />
            ) : null}
            {signal.momentum > 0 ? "+" : ""}
            {signal.momentum}
          </div>
        </div>
        <div className="bg-[#0a0e14] rounded px-2 py-1.5">
          <div className="text-[10px] uppercase text-slate-500">EMA</div>
          <div
            className={cn(
              "font-mono text-xs font-semibold",
              signal.emaCross === "BULLISH"
                ? "text-emerald-400"
                : signal.emaCross === "BEARISH"
                ? "text-rose-400"
                : "text-amber-400"
            )}
          >
            {signal.emaCross === "BULLISH"
              ? "9>21"
              : signal.emaCross === "BEARISH"
              ? "9<21"
              : "9=21"}
          </div>
        </div>
      </div>

      {/* Bias tags */}
      <div className="flex flex-wrap gap-1.5">
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] font-mono border-[#1c2530]",
            signal.vwapBias === "ABOVE"
              ? "bg-emerald-500/10 text-emerald-400"
              : signal.vwapBias === "BELOW"
              ? "bg-rose-500/10 text-rose-400"
              : "bg-amber-500/10 text-amber-400"
          )}
        >
          VWAP {signal.vwapBias}
        </Badge>
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] font-mono border-[#1c2530]",
            signal.pcrTrend === "RISING"
              ? "bg-emerald-500/10 text-emerald-400"
              : signal.pcrTrend === "FALLING"
              ? "bg-rose-500/10 text-rose-400"
              : "bg-amber-500/10 text-amber-400"
          )}
        >
          PCR {signal.pcrTrend}
        </Badge>
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] font-mono border-[#1c2530]",
            signal.oiFlowBias === "PUT WRITING"
              ? "bg-emerald-500/10 text-emerald-400"
              : signal.oiFlowBias === "CALL WRITING"
              ? "bg-rose-500/10 text-rose-400"
              : "bg-amber-500/10 text-amber-400"
          )}
        >
          {signal.oiFlowBias}
        </Badge>
      </div>

      {/* Confidence bar */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">
            Confidence
          </span>
          <span className="text-[10px] text-slate-400 font-mono">
            {signal.confidence}/100
          </span>
        </div>
        <Progress
          value={signal.confidence}
          className="h-1.5 bg-[#1c2530]"
          // tinted by value via indicator style
        />
      </div>

      {/* Reasoning */}
      <div className="border-t border-[#1c2530] pt-2">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
          Why this signal
        </div>
        <ul className="space-y-0.5">
          {signal.reasoning.slice(0, 4).map((r, i) => (
            <li
              key={i}
              className="text-[11px] text-slate-400 flex items-start gap-1.5"
            >
              <span className="text-slate-600 mt-0.5">•</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
