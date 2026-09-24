"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, XCircle, MinusCircle, ShieldAlert, BrainCircuit } from "lucide-react";
import type { SmartSignal } from "@/lib/smart-signal-engine";
import { cn } from "@/lib/utils";

export function SmartSignalPanel({ smart }: { smart: SmartSignal }) {
  const bullish = smart.action === "BUY CE";
  const bearish = smart.action === "BUY PE";
  const tone = bullish ? "emerald" : bearish ? "rose" : "amber";
  const toneClass = bullish ? "text-emerald-400" : bearish ? "text-rose-400" : "text-amber-400";
  const bar = bullish ? smart.bullishScore : bearish ? smart.bearishScore : Math.max(smart.bullishScore, smart.bearishScore);

  return (
    <Card className="bg-[#0f1620] border-[#1c2530] p-4">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BrainCircuit className={cn("h-5 w-5", toneClass)} />
            <h2 className="text-base font-semibold text-slate-200">AI / Smart Signal Engine</h2>
            <Badge variant="outline" className={cn("text-[10px] font-mono", toneClass)}>v{smart.engineVersion.replace("smart-v", "")}</Badge>
          </div>
          <p className="text-xs text-slate-500 mt-1">{smart.summary}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className={cn("text-3xl font-mono font-bold", toneClass)}>{smart.score}/100</div>
            <div className="text-[10px] text-slate-500">directional strength</div>
          </div>
          <Badge className={cn("px-3 py-1", bullish ? "bg-emerald-500/15 text-emerald-400" : bearish ? "bg-rose-500/15 text-rose-400" : "bg-amber-500/15 text-amber-400")}>{smart.action}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-4">
        {[
          ["Bull", smart.bullishScore],
          ["Bear", smart.bearishScore],
          ["Edge", smart.edge],
          ["Confidence", smart.confidence],
          ["Quality", smart.quality],
        ].map(([label, value]) => (
          <div key={label} className="rounded-md bg-[#0a0e14] px-3 py-2">
            <div className="text-[10px] uppercase text-slate-500">{label}</div>
            <div className={cn("font-mono font-semibold mt-0.5", label === "Quality" ? toneClass : "text-slate-200")}>{value}{typeof value === "number" && label !== "Edge" ? "/100" : ""}</div>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <div className="flex justify-between text-[10px] text-slate-500 mb-1"><span>Directional strength</span><span>{bar}/100</span></div>
        <Progress value={bar} className="h-2 bg-[#1c2530]" />
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2">
        {smart.factors.map(f => (
          <div key={f.key} className="rounded-md border border-[#1c2530] bg-[#0a0e14] p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {f.status === "BULLISH" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> :
                 f.status === "BEARISH" ? <XCircle className="h-3.5 w-3.5 text-rose-400" /> :
                 f.status === "NO_DATA" ? <ShieldAlert className="h-3.5 w-3.5 text-amber-400" /> :
                 <MinusCircle className="h-3.5 w-3.5 text-slate-500" />}
                <span className="text-xs text-slate-200">{f.label}</span>
              </div>
              <span className="text-[10px] font-mono text-slate-500">w {f.weight}%</span>
            </div>
            <div className="mt-1 text-[11px] text-slate-400">{f.reason}</div>
            <div className="mt-1 text-[10px] font-mono text-slate-600">factor {f.score > 0 ? "+" : ""}{f.score} · contribution {f.contribution > 0 ? "+" : ""}{f.contribution}</div>
          </div>
        ))}
      </div>

      {smart.blockers.length > 0 && (
        <div className="mt-4 rounded-md border border-amber-700/40 bg-amber-950/20 p-3">
          <div className="text-[10px] uppercase tracking-wider text-amber-400 mb-1">Why WAIT / Risk blockers</div>
          <ul className="space-y-1">
            {smart.blockers.map((b, i) => <li key={i} className="text-[11px] text-amber-200/80">• {b}</li>)}
          </ul>
        </div>
      )}
    </Card>
  );
}
