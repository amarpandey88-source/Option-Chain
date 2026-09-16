"use client";

import { Card } from "@/components/ui/card";
import { Sparkline } from "./sparkline";

interface HistoryPanelProps {
  history: {
    spot: { t: string; v: number }[];
    pcr: { t: string; v: number }[];
    vix: { t: string; v: number }[];
  };
}

export function HistoryPanel({ history }: HistoryPanelProps) {
  const spotValues = history.spot.map((d) => d.v);
  const pcrValues = history.pcr.map((d) => d.v);
  const vixValues = history.vix.map((d) => d.v);

  const spotChange = spotValues.length
    ? spotValues[spotValues.length - 1] - spotValues[0]
    : 0;
  const spotChangePct = spotValues.length
    ? (spotChange / spotValues[0]) * 100
    : 0;

  return (
    <Card className="bg-[#0f1620] border-[#1c2530] p-3">
      <h3 className="text-sm font-semibold text-slate-200 mb-2">
        Live Trend · 30 min
      </h3>
      <div className="space-y-2.5">
        <TrendRow
          label="Spot"
          value={spotValues[spotValues.length - 1]?.toFixed(2) ?? "—"}
          change={spotChangePct}
          data={history.spot}
          color="#10b981"
        />
        <TrendRow
          label="PCR"
          value={pcrValues[pcrValues.length - 1]?.toFixed(2) ?? "—"}
          change={
            pcrValues.length
              ? pcrValues[pcrValues.length - 1] - pcrValues[0]
              : 0
          }
          changeUnit=""
          data={history.pcr}
          color="#f59e0b"
        />
        <TrendRow
          label="India VIX"
          value={vixValues[vixValues.length - 1]?.toFixed(2) ?? "—"}
          change={
            vixValues.length
              ? vixValues[vixValues.length - 1] - vixValues[0]
              : 0
          }
          changeUnit=""
          data={history.vix}
          color="#06b6d4"
        />
      </div>
    </Card>
  );
}

function TrendRow({
  label,
  value,
  change,
  changeUnit = "%",
  data,
  color,
}: {
  label: string;
  value: string;
  change: number;
  changeUnit?: string;
  data: { t: string; v: number }[];
  color: string;
}) {
  const positive = change >= 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] uppercase tracking-wider text-slate-500">
          {label}
        </span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-slate-200">
            {value}
          </span>
          <span
            className={`font-mono text-[11px] ${
              positive ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {positive ? "+" : ""}
            {change.toFixed(2)}
            {changeUnit}
          </span>
        </div>
      </div>
      <Sparkline data={data} color={color} height={32} />
    </div>
  );
}
