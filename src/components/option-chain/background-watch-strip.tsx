"use client";

import { useEffect, useState } from "react";
import { Radar } from "lucide-react";
import { cn } from "@/lib/utils";
import { Symbol } from "@/lib/types";

interface WatchEntry {
  symbol: Symbol; lastCheckedAt: number; lastSignal: string; lastConfidence: number;
  openTradeId: string | null; error: string | null; handsOff: boolean;
}

export function BackgroundWatchStrip({ activeSymbol }: { activeSymbol: Symbol }) {
  const [entries, setEntries] = useState<WatchEntry[]>([]);

  useEffect(() => {
    const poll = () => fetch("/api/multi-watch", { cache: "no-store" }).then(r => r.json()).then(d => setEntries(d.symbols || [])).catch(() => {});
    poll();
    const interval = setInterval(poll, 15_000);
    return () => clearInterval(interval);
  }, []);

  const others = entries.filter(e => e.symbol !== activeSymbol);
  if (others.length === 0) return null;

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 text-[11px] text-slate-500 border-b border-[#1c2530] bg-[#0a0e14]">
      <span className="flex items-center gap-1 text-slate-600"><Radar className="h-3 w-3" /> Watching in background:</span>
      {others.map(e => (
        <span key={e.symbol} className="flex items-center gap-1.5">
          <span className="text-slate-400 font-medium">{e.symbol}</span>
          {e.openTradeId ? (
            <span className="text-cyan-400">● trade open</span>
          ) : e.lastCheckedAt === 0 ? (
            <span className="text-slate-600">checking…</span>
          ) : (
            <span className={cn(e.lastSignal === "WAIT" ? "text-slate-500" : e.lastConfidence >= 75 ? "text-amber-400" : "text-slate-500")}>
              {e.lastSignal} {e.lastSignal !== "WAIT" ? `${e.lastConfidence}%` : ""}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
