"use client";

import { Card } from "@/components/ui/card";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AlertConfig } from "./alert-manager";

interface Props {
  action: "BUY CE" | "BUY PE" | "WAIT" | "EXIT";
  confidence: number;
  riskReward: number;
  lowLiquidity: boolean;
  isLocked: boolean;
  tf5: string; tf15: string; tf30: string;
  hasActiveTrade: boolean;
  alertsAllowed: boolean;
  config: AlertConfig;
}

interface CheckItem { label: string; pass: boolean; detail: string; }

export function AlertReadinessCard({ action, confidence, riskReward, lowLiquidity, isLocked, tf5, tf15, tf30, hasActiveTrade, alertsAllowed, config }: Props) {
  const isBull = action === "BUY CE";
  const isBear = action === "BUY PE";
  const isDirectional = isBull || isBear;

  const checks: CheckItem[] = [
    { label: "Real (broker) data", pass: alertsAllowed, detail: alertsAllowed ? "Broker mode" : "NSE view mode — alerts only fire in Broker mode" },
    { label: "Alerts enabled", pass: config.enabled, detail: config.enabled ? "On" : "Off in Alert Settings" },
    { label: "Directional signal", pass: isDirectional, detail: isDirectional ? action : "Currently WAIT/EXIT" },
    { label: `Direction allowed`, pass: !isDirectional || (isBull ? config.alertOnBull : config.alertOnBear), detail: isDirectional ? (isBull ? "BUY CE enabled" : "BUY PE enabled") : "—" },
    { label: "Confidence ≥ threshold", pass: confidence >= config.threshold, detail: `${confidence}% vs ${config.threshold}% needed` },
    { label: "Risk:reward ≥ minimum", pass: riskReward >= config.minRiskReward, detail: `1:${riskReward} vs 1:${config.minRiskReward.toFixed(1)} needed` },
    { label: "Liquidity OK", pass: !config.requireLiquidity || !lowLiquidity, detail: !config.requireLiquidity ? "Not required" : lowLiquidity ? "Too thin at this strike" : "OK" },
    { label: "Signal locked (stable)", pass: !config.requireStableSignal || isLocked, detail: !config.requireStableSignal ? "Not required" : isLocked ? "Locked" : "Still forming" },
    { label: "Timeframes agree", pass: !config.requireAllTimeframesAgree || (tf5 === action && tf15 === action && tf30 === action), detail: !config.requireAllTimeframesAgree ? "Not required" : `5m ${tf5} · 15m ${tf15} · 30m ${tf30}` },
    { label: "No trade already open", pass: !hasActiveTrade, detail: hasActiveTrade ? "A trade is currently active" : "Clear" },
  ];

  const allPass = checks.every(c => c.pass);
  const failCount = checks.filter(c => !c.pass).length;

  return (
    <Card className="bg-[#0f1620] border-[#1c2530] p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-slate-200">Alert Readiness</span>
        <span className={cn("text-[10px] font-mono px-2 py-0.5 rounded border", allPass ? "bg-emerald-500/10 text-emerald-400 border-emerald-700/40" : "bg-slate-700/20 text-slate-400 border-slate-700/40")}>
          {allPass ? "READY TO FIRE" : `${failCount} condition${failCount > 1 ? "s" : ""} blocking`}
        </span>
      </div>
      <div className="space-y-1.5">
        {checks.map((c, i) => (
          <div key={i} className="flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-2">
              {c.pass ? <Check className="h-3 w-3 text-emerald-400 shrink-0" /> : <X className="h-3 w-3 text-rose-400 shrink-0" />}
              <span className={c.pass ? "text-slate-300" : "text-slate-400"}>{c.label}</span>
            </div>
            <span className="text-slate-500 font-mono text-[10px]">{c.detail}</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-600 mt-3 pt-2 border-t border-slate-700/30">
        Every condition above must pass at once for a trade alert to fire — this shows exactly which one(s) are currently holding it back.
      </p>
    </Card>
  );
}
