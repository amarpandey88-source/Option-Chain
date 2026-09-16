"use client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, TrendingUp, TrendingDown, Target, Shield, Award, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface ActiveTradePanelProps {
  trade: { id: string; openedAt: number; action: "BUY CE" | "BUY PE"; strike: number; entryPremium: number; stopLossPremium: number; target1Premium: number; target2Premium: number; target3Premium: number; entrySpot: number; confidence: number; optionType: "CE" | "PE"; lotSize: number; slMovedToBreakeven: boolean; };
  currentPremium: number; currentSpot: number; onClose: () => void;
  journalStatus?: "saving" | "saved" | "failed";
  onRetryJournal?: () => void;
  // True while a live Fyers tick stream is actually feeding currentPremium
  // (see the liveLtp effect in page.tsx) — false means SL/target checks
  // are still on the normal poll interval, same as before this existed.
  isLive?: boolean;
}

export function ActiveTradePanel({ trade, currentPremium, currentSpot, onClose, journalStatus = "saved", onRetryJournal, isLive = false }: ActiveTradePanelProps) {
  const isBull = trade.action === "BUY CE";
  const pnlPerLot = currentPremium - trade.entryPremium;
  const totalPnl = pnlPerLot * trade.lotSize;
  const pnlPct = (pnlPerLot / trade.entryPremium) * 100;
  // Progress bar tracks SL -> Target 1 now, since Target 1 (fixed 1:2 RR)
  // is the trade's actual designed exit point, not Target 3.
  const range = trade.target1Premium - trade.stopLossPremium;
  const progressPct = Math.max(0, Math.min(100, ((currentPremium - trade.stopLossPremium) / range) * 100));
  let status: { label: string; color: string };
  if (currentPremium <= trade.stopLossPremium) status = { label: "SL HIT", color: "text-rose-400" };
  else if (currentPremium >= trade.target1Premium) status = { label: "TARGET 1 HIT (1:2)", color: "text-emerald-400" };
  else if (currentPremium >= trade.entryPremium) status = { label: "IN PROFIT", color: "text-emerald-300" };
  else status = { label: "IN LOSS", color: "text-rose-300" };
  const duration = Math.round((Date.now() - trade.openedAt) / 1000);
  const minutes = Math.floor(duration / 60); const seconds = duration % 60;
  const pnlPositive = totalPnl >= 0;
  return (
    <Card className={cn("border-2 p-3 relative overflow-hidden", isBull ? "bg-emerald-950/30 border-emerald-700/60" : "bg-rose-950/30 border-rose-700/60")}>
      <div className={cn("absolute inset-0 opacity-30 pointer-events-none", isBull ? "bg-gradient-to-br from-emerald-600/10 to-transparent" : "bg-gradient-to-br from-rose-600/10 to-transparent")} />
      <div className="relative">
        <div className="flex flex-wrap items-start justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-2.5">
            <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center border shrink-0", isBull ? "bg-emerald-500/20 border-emerald-700/40" : "bg-rose-500/20 border-rose-700/40")}>
              {isBull ? <TrendingUp className="h-4 w-4 text-emerald-400" /> : <TrendingDown className="h-4 w-4 text-rose-400" />}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider text-slate-400">Active Trade</span>
                <Badge variant="outline" className={cn("text-[9px] font-mono", isLive ? "animate-pulse" : "", isBull ? "bg-emerald-500/20 text-emerald-300 border-emerald-700/50" : "bg-rose-500/20 text-rose-300 border-rose-700/50")}>
                  {isLive ? "● LIVE TICK" : "◌ POLLING"}
                </Badge>
                <span className="text-[9px] text-slate-500 font-mono flex items-center gap-1"><Clock className="h-2.5 w-2.5" />{minutes}m {seconds}s</span>
                {journalStatus === "saving" && (
                  <Badge variant="outline" className="text-[9px] font-mono bg-slate-500/10 text-slate-400 border-slate-600/40">⏳ Saving to journal…</Badge>
                )}
                {journalStatus === "failed" && (
                  <button
                    type="button"
                    onClick={onRetryJournal}
                    className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-amber-600/50 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 transition-colors"
                    title="This trade is running but was NOT saved to the Trade Journal. Click to retry."
                  >
                    ⚠ Not saved to journal — retry
                  </button>
                )}
              </div>
              <h2 className="text-base font-bold text-slate-100 font-mono mt-0.5">{trade.action} {trade.strike} {trade.optionType}<span className="ml-2 text-[11px] font-normal text-slate-500">{trade.lotSize} qty</span></h2>
            </div>
          </div>
          <div className="text-right">
            <div className={cn("text-xl font-mono font-bold", pnlPositive ? "text-emerald-400" : "text-rose-400")}>{pnlPositive ? "+" : "−"}₹{Math.abs(totalPnl).toFixed(0)}</div>
            <div className={cn("text-[11px] font-mono", pnlPositive ? "text-emerald-400" : "text-rose-400")}>{pnlPositive ? "+" : ""}{pnlPct.toFixed(1)}% · ₹{pnlPerLot.toFixed(1)}/lot</div>
            <div className={cn("text-[9px] uppercase tracking-wider mt-0.5", status.color)}>{status.label}</div>
          </div>
        </div>
        <div className="mb-2.5">
          <div className="flex items-center justify-between mb-1 text-[9px] uppercase tracking-wider">
            <span className="text-rose-400 flex items-center gap-1"><Shield className="h-2.5 w-2.5" /> SL {trade.stopLossPremium}{trade.slMovedToBreakeven && <span className="text-cyan-400 ml-1">(breakeven)</span>}</span>
            <span className="text-cyan-300">Entry {trade.entryPremium}</span>
            <span className="text-slate-400">Current {currentPremium.toFixed(0)}</span>
            <span className="text-emerald-400 flex items-center gap-1"><Award className="h-2.5 w-2.5" /> T1 {trade.target1Premium} (exit)</span>
          </div>
          <div className="relative h-2 rounded-full bg-rose-500/20 overflow-hidden">
            <div className="absolute inset-0" style={{ background: "linear-gradient(to right, rgba(244,63,94,0.3) 0%, rgba(132,204,22,0.2) 50%, rgba(16,185,129,0.4) 100%)" }} />
            <div className="absolute top-0 bottom-0 w-1 bg-white shadow-lg" style={{ left: `${progressPct}%` }}><div className="absolute -top-1 -left-1.5 h-3.5 w-3.5 rounded-full bg-white border-2 border-slate-900 shadow-lg" /></div>
          </div>
          <div className="flex justify-between text-[9px] text-slate-500 mt-1 font-mono"><span className="text-slate-300">T1 {trade.target1Premium} ★</span><span>T2 {trade.target2Premium} (ref)</span><span>T3 {trade.target3Premium} (ref)</span></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2.5">
          <Stat label="Entry Premium" value={String(trade.entryPremium)} sub={`Spot was ${trade.entrySpot}`} color="text-cyan-300" />
          <Stat label="Current Premium" value={currentPremium.toFixed(0)} sub={`Spot now ${currentSpot}`} color={pnlPositive ? "text-emerald-300" : "text-rose-300"} />
          <Stat label="Spot Move" value={`${currentSpot - trade.entrySpot >= 0 ? "+" : ""}${(currentSpot - trade.entrySpot).toFixed(1)}`} sub={`${(((currentSpot - trade.entrySpot) / trade.entrySpot) * 100).toFixed(2)}%`} color={isBull ? (currentSpot >= trade.entrySpot ? "text-emerald-300" : "text-rose-300") : (currentSpot <= trade.entrySpot ? "text-emerald-300" : "text-rose-300")} />
          <Stat label="Confidence" value={`${trade.confidence}%`} sub="at entry" color="text-amber-300" />
        </div>
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-700/40">
          <div className="text-[10px] text-slate-400">Auto-exits when SL or Target 1 (1:2 RR) is hit, or at 3:15 PM (EOD square-off). SL trails to breakeven at 50% of target. Manually close anytime.</div>
          <Button variant="outline" size="sm" onClick={onClose} className={cn("h-7 text-xs bg-[#0a0e14] border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-slate-100", pnlPositive ? "border-emerald-700/40 text-emerald-400 hover:bg-emerald-950/40" : "border-rose-700/40 text-rose-400 hover:bg-rose-950/40")}><X className="h-3.5 w-3.5 mr-1" /> Close Trade</Button>
        </div>
      </div>
    </Card>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return <div className="bg-[#0a0e14]/60 border border-slate-700/40 rounded-md px-2 py-1.5"><div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div><div className={cn("font-mono text-sm font-bold mt-0.5", color)}>{value}</div><div className="text-[9px] text-slate-500 font-mono">{sub}</div></div>;
}
