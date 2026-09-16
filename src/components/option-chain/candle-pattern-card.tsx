"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus, CandlestickChart } from "lucide-react";
import { cn } from "@/lib/utils";

interface CandlePattern { name: string; type: "bullish" | "bearish" | "neutral"; description: string; }

interface Props {
  pattern: CandlePattern | null;
}

export function CandlePatternCard({ pattern }: Props) {
  const isBull = pattern?.type === "bullish";
  const isBear = pattern?.type === "bearish";
  const Icon = !pattern ? Minus : isBull ? TrendingUp : isBear ? TrendingDown : Minus;
  const color = !pattern ? "text-slate-500" : isBull ? "text-emerald-400" : isBear ? "text-rose-400" : "text-amber-400";
  const bg = !pattern ? "" : isBull ? "bg-emerald-500/10 border-emerald-700/30" : isBear ? "bg-rose-500/10 border-rose-700/30" : "bg-amber-500/10 border-amber-700/30";

  return (
    <Card className={cn("bg-[#0f1620] border-[#1c2530] p-3", pattern && bg)}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <CandlestickChart className="h-4 w-4 text-slate-400" />
          <span className="text-sm font-semibold text-slate-200">Candlestick Pattern</span>
        </div>
        <Badge variant="outline" className="text-[9px] font-mono bg-slate-700/20 text-slate-400 border-slate-700/40">
          LAST 5M CANDLE
        </Badge>
      </div>

      {pattern ? (
        <>
          <div className="flex items-center gap-2 mb-1.5">
            <Icon className={cn("h-4 w-4", color)} />
            <span className={cn("text-sm font-bold", color)}>{pattern.name}</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">{pattern.description}</p>
        </>
      ) : (
        <div className="flex items-center gap-2 py-1">
          <Minus className="h-4 w-4 text-slate-600" />
          <span className="text-xs text-slate-500">No notable pattern on the last candle right now.</span>
        </div>
      )}

      <p className="text-[10px] text-slate-600 mt-2 pt-2 border-t border-slate-700/30">
        Factored into the 5 Min signal's confidence score above (not 15/30 Min, since those aren't built from a real 15/30-min candle).
      </p>
    </Card>
  );
}
