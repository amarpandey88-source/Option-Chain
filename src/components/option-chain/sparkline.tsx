"use client";

import { ResponsiveContainer, Area, AreaChart, Tooltip, XAxis, YAxis } from "recharts";

interface SparklineProps {
  data: { t: string; v: number }[];
  name?: string;
  color?: string;
  height?: number;
  domain?: [number, number];
}

export function Sparkline({
  data,
  name = "Value",
  color = "#10b981",
  height = 36,
  domain,
}: SparklineProps) {
  if (!data || data.length === 0) return null;
  const values = data.map((d) => d.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.1 || 1;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis
          domain={domain ?? [min - pad, max + pad]}
          hide
        />
        <XAxis dataKey="t" hide />
        <Tooltip
          labelFormatter={(label) => new Date(String(label)).toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata",
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          })}
          formatter={(value) => [Number(value).toFixed(2), name]}
          contentStyle={{ backgroundColor: "#0a0e14", border: "1px solid #334155", borderRadius: 4, fontSize: 11 }}
          labelStyle={{ color: "#cbd5e1" }}
          itemStyle={{ color }}
          wrapperStyle={{ zIndex: 50 }}
        />
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#grad-${color})`}
          isAnimationActive={false}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
