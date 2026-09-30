"use client";

import { Card } from "@/components/ui/card";
import { Sparkline } from "./sparkline";

interface HistoryPanelProps {
  history: {
    spot: { t: string; v: number }[];
    pcr: { t: string; v: number }[];
    vix: { t: string; v: number }[];
    rsi5: { t: string; v: number }[];
    rsi15: { t: string; v: number }[];
    rsi30: { t: string; v: number }[];
  };
}

export function HistoryPanel({ history }: HistoryPanelProps) {
  const spotValues = history.spot.map((d) => d.v);
  const pcrValues = history.pcr.map((d) => d.v);
  const vixValues = history.vix.map((d) => d.v);
  const rsiRows = [
    { label: "RSI 5m", data: history.rsi5, color: "#f472b6" },
    { label: "RSI 15m", data: history.rsi15, color: "#fb923c" },
    { label: "RSI 30m", data: history.rsi30, color: "#60a5fa" },
  ];

  const spotChange = spotValues.length
    ? spotValues[spotValues.length - 1] - spotValues[0]
    : 0;
  const spotChangePct = spotValues.length
    ? (spotChange / spotValues[0]) * 100
    : 0;

  return (
    <Card className="bg-[#0f1620] border-[#1c2530] p-3">
      <h3 className="text-sm font-semibold text-slate-200 mb-2">
        Market Trend · Recent History
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
        {rsiRows.map(({ label, data, color }) => {
          const values = data.map((point) => point.v);
          return (
            <TrendRow
              key={label}
              label={label}
              value={values[values.length - 1]?.toFixed(1) ?? "—"}
              change={values.length ? values[values.length - 1] - values[0] : 0}
              changeUnit=" pts"
              data={data}
              color={color}
              domain={[0, 100]}
            />
          );
        })}
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
  domain,
}: {
  label: string;
  value: string;
  change: number;
  changeUnit?: string;
  data: { t: string; v: number }[];
  color: string;
  domain?: [number, number];
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
      <Sparkline data={data} name={label} color={color} height={32} domain={domain} />
    </div>
  );
}
