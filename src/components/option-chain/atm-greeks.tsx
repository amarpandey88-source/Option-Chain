"use client";

import { Card } from "@/components/ui/card";
import { ATMGreeks } from "@/lib/types";

interface AtmGreeksProps {
  greeks: ATMGreeks;
  atmStrike: number;
}

const GREEK_INFO: Record<
  keyof Omit<ATMGreeks, "interpretation" | "iv">,
  { name: string; desc: string; color: string }
> = {
  delta: {
    name: "Delta",
    desc: "Directional exposure — how much option moves per ₹1 spot move",
    color: "text-cyan-300",
  },
  gamma: {
    name: "Gamma",
    desc: "Rate of delta change — accelerates near ATM",
    color: "text-emerald-400",
  },
  theta: {
    name: "Theta",
    desc: "Time decay — premium lost per day (negative)",
    color: "text-rose-400",
  },
  vega: {
    name: "Vega",
    desc: "IV sensitivity — premium change per 1% IV move",
    color: "text-amber-400",
  },
};

export function AtmGreeks({ greeks, atmStrike }: AtmGreeksProps) {
  return (
    <Card className="bg-[#0f1620] border-[#1c2530] p-3">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">
            ATM Greeks
            <span className="ml-2 text-xs text-slate-500 font-mono">
              Strike {atmStrike}
            </span>
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {greeks.interpretation}
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">
            ATM IV
          </div>
          <div className="font-mono text-base font-bold text-amber-400">
            {greeks.iv}%
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(Object.keys(GREEK_INFO) as Array<keyof typeof GREEK_INFO>).map(
          (key) => {
            const info = GREEK_INFO[key];
            const value = greeks[key];
            return (
              <div
                key={key}
                className="bg-[#0a0e14] border border-[#1c2530] rounded-md px-3 py-2"
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500">
                    {info.name}
                  </span>
                </div>
                <div className={`font-mono text-lg font-bold ${info.color}`}>
                  {value}
                </div>
                <div className="text-[10px] text-slate-500 leading-tight mt-0.5">
                  {info.desc}
                </div>
              </div>
            );
          }
        )}
      </div>
    </Card>
  );
}
