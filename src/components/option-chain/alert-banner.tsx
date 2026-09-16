"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, TrendingUp, TrendingDown, Bell, Target, Shield, Volume2 } from "lucide-react";
import { AlertEvent } from "./alert-manager";
import { cn } from "@/lib/utils";

interface AlertBannerProps { alert: AlertEvent | null; onDismiss: () => void; soundEnabled: boolean; }

export function AlertBanner({ alert, onDismiss, soundEnabled }: AlertBannerProps) {
  const visible = alert !== null;
  const [flashOn, setFlashOn] = useState(true);
  useEffect(() => {
    if (!alert) return;
    const fi = setInterval(() => setFlashOn(v => !v), 500);
    const sf = setTimeout(() => { clearInterval(fi); setFlashOn(false); }, 8000);
    return () => { clearInterval(fi); clearTimeout(sf); };
  }, [alert?.id]);
  if (!alert || !visible) return null;
  const isBull = alert.action === "BUY CE";
  return (
    <div className={cn("fixed top-0 left-0 right-0 z-50 transition-transform duration-300", visible ? "translate-y-0" : "-translate-y-full")}>
      <div className={cn("border-b-2 transition-colors duration-200 backdrop-blur-md", isBull ? flashOn ? "bg-emerald-600/30 border-emerald-500" : "bg-emerald-700/20 border-emerald-700/60" : flashOn ? "bg-rose-600/30 border-rose-500" : "bg-rose-700/20 border-rose-700/60")}>
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0", isBull ? "bg-emerald-500/20" : "bg-rose-500/20")}>
                {isBull ? <TrendingUp className="h-6 w-6 text-emerald-400" /> : <TrendingDown className="h-6 w-6 text-rose-400" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Bell className={cn("h-4 w-4 flex-shrink-0", isBull ? "text-emerald-400" : "text-rose-400")} />
                  <span className={cn("text-sm font-bold tracking-wide", isBull ? "text-emerald-300" : "text-rose-300")}>{isBull ? "BULLISH SIGNAL" : "BEARISH SIGNAL"}</span>
                  <Badge variant="outline" className={cn("text-[10px] font-mono", isBull ? "bg-emerald-500/10 text-emerald-300 border-emerald-600/40" : "bg-rose-500/10 text-rose-300 border-rose-600/40")}>{alert.action} {alert.strike}</Badge>
                  <Badge variant="outline" className="text-[10px] font-mono bg-amber-500/10 text-amber-300 border-amber-700/40">{alert.confidence}% confidence</Badge>
                  {soundEnabled && <Volume2 className="h-3 w-3 text-slate-400 animate-pulse" />}
                  <span className="text-[11px] text-slate-400 font-mono">{new Date(alert.ts).toLocaleTimeString("en-IN", { hour12: false })}</span>
                </div>
                <div className="text-[11px] text-slate-300 mt-1 truncate"><span className="font-semibold text-slate-200">{alert.symbol}</span> · {alert.reasoning.slice(0, 120)}{alert.reasoning.length > 120 ? "…" : ""}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="hidden md:flex items-center gap-1.5 text-[10px] font-mono">
                <span className="px-2 py-1 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-700/30">Entry {alert.entry}</span>
                <span className="px-2 py-1 rounded bg-rose-500/10 text-rose-300 border border-rose-700/30 flex items-center gap-1"><Shield className="h-2.5 w-2.5" /> SL {alert.stopLoss}</span>
                <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-700/30 flex items-center gap-1"><Target className="h-2.5 w-2.5" /> T1 {alert.target1}</span>
              </div>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-400 hover:text-slate-100 hover:bg-slate-700/40" onClick={onDismiss}><X className="h-4 w-4" /></Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
