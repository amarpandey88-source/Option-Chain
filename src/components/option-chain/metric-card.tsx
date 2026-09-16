"use client";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface MetricCardProps {
  label: string;
  value: ReactNode;
  sublabel?: ReactNode;
  accent?: "bull" | "bear" | "neutral" | "info" | "warning";
  footer?: ReactNode;
  className?: string;
}

const ACCENT_STYLES: Record<
  NonNullable<MetricCardProps["accent"]>,
  { ring: string; value: string; dot: string }
> = {
  bull: {
    ring: "hover:border-emerald-700/40",
    value: "text-emerald-400",
    dot: "bg-emerald-500",
  },
  bear: {
    ring: "hover:border-rose-700/40",
    value: "text-rose-400",
    dot: "bg-rose-500",
  },
  neutral: {
    ring: "hover:border-amber-700/40",
    value: "text-amber-400",
    dot: "bg-amber-500",
  },
  info: {
    ring: "hover:border-cyan-700/40",
    value: "text-cyan-300",
    dot: "bg-cyan-500",
  },
  warning: {
    ring: "hover:border-orange-700/40",
    value: "text-orange-400",
    dot: "bg-orange-500",
  },
};

export function MetricCard({
  label,
  value,
  sublabel,
  accent = "info",
  footer,
  className,
}: MetricCardProps) {
  const s = ACCENT_STYLES[accent];
  return (
    <Card
      className={cn(
        "bg-[#0f1620] border-[#1c2530] py-2 px-3 transition-colors duration-150",
        s.ring,
        className
      )}
    >
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
          {label}
        </span>
        <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      </div>
      <div className={cn("font-mono text-xl font-semibold leading-tight", s.value)}>
        {value}
      </div>
      {sublabel && (
        <div className="text-[11px] text-slate-500 mt-1 truncate">{sublabel}</div>
      )}
      {footer && <div className="mt-2">{footer}</div>}
    </Card>
  );
}
