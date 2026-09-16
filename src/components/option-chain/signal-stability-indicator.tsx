"use client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lock, Unlock, Clock, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { SignalStability, TradeAction } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props { stability: SignalStability; overallAction: TradeAction; confidence: number; refreshIntervalSec: number; }

export function SignalStabilityIndicator({ stability, overallAction, confidence, refreshIntervalSec }: Props) {
  const isLocked = stability.isLocked;
  const isBull = overallAction === "BUY CE";
  const isBear = overallAction === "BUY PE";
  const isWait = overallAction === "WAIT" || overallAction === "EXIT";
  const Icon = isWait ? Minus : isBull ? TrendingUp : TrendingDown;
  const color = isWait ? "amber" : isBull ? "emerald" : "rose";
  const cm: Record<string, { text: string; bg: string; border: string }> = {
    emerald: { text: "text-emerald-400", bg: "bg-emerald-500/5", border: "border-emerald-700/40" },
    rose: { text: "text-rose-400", bg: "bg-rose-500/5", border: "border-rose-700/40" },
    amber: { text: "text-amber-400", bg: "bg-amber-500/5", border: "border-amber-700/40" },
  };
  const c = cm[color];
  const bars = Math.min(3, stability.consecutiveCount);
  return (
    <Card className={cn("border p-3", isLocked ? c.bg + " " + c.border + " ring-1 ring-" + color + "-700/30" : "bg-[#0f1620] border-[#1c2530]")}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">{isLocked ? <Lock className={cn("h-3.5 w-3.5", c.text)} /> : <Unlock className="h-3.5 w-3.5 text-slate-500" />}<span className="text-xs font-semibold text-slate-200">Signal Stability</span></div>
        <Badge variant="outline" className={cn("text-[9px] font-mono", isLocked ? c.bg + " " + c.text + " " + c.border : "bg-slate-700/20 text-slate-400 border-slate-700/40")}>{isLocked ? "LOCKED" : "PENDING"}</Badge>
      </div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2"><Icon className={cn("h-4 w-4", c.text)} /><div><div className={cn("text-sm font-bold", c.text)}>{overallAction}</div><div className="text-[9px] text-slate-500">{confidence}% confidence</div></div></div>
        <div className="flex items-end gap-1">{[1, 2, 3].map(i => <div key={i} className={cn("w-1.5 rounded-sm transition-all", i <= bars ? isLocked ? c.bg.replace("/5", "/40") + " " + c.text.replace("400", "500") : c.bg.replace("/5", "/20") : "bg-slate-700/40")} style={{ height: `${6 + i * 5}px` }} />)}</div>
      </div>
      <div className="grid grid-cols-2 gap-1.5 text-center">
        <div className="bg-[#0a0e14] rounded px-2 py-1"><div className="text-[9px] uppercase text-slate-500">Confirmations</div><div className={cn("font-mono text-xs font-semibold", c.text)}>{stability.consecutiveCount}/3</div></div>
        <div className="bg-[#0a0e14] rounded px-2 py-1"><div className="text-[9px] uppercase text-slate-500 flex items-center justify-center gap-0.5"><Clock className="h-2.5 w-2.5" /> Stable for</div><div className={cn("font-mono text-xs font-semibold", c.text)}>{stability.stableSeconds}s</div></div>
      </div>
      <div className="mt-2 text-[10px] text-slate-400 leading-relaxed border-t border-slate-700/30 pt-1.5">
        {isLocked ? <><span className={c.text}>✓ Signal stable.</span> Trade alerts will fire when confidence ≥ threshold & no active trade.</> : isWait ? <>Waiting for a directional signal (BUY CE / BUY PE). No alerts until signal emerges.</> : <>Signal needs <span className={c.text}>{3 - stability.consecutiveCount} more confirmation{3 - stability.consecutiveCount > 1 ? "s" : ""}</span> (≈{(3 - stability.consecutiveCount) * refreshIntervalSec}s) before alerting.</>}
      </div>
    </Card>
  );
}
