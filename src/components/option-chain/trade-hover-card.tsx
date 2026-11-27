"use client";
import type { ReactNode } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { EntryContext } from "@/lib/trade-reference-core";

// The slice of a journal row this card reads. Kept structural (not imported
// from the panel) so the card stays independent of the panel's own types.
export interface HoverTrade {
  alertId: string; symbol: string; action: string; optionType: string; strike: number;
  entryPremium: number; stopLoss: number; target1: number; target2: number; target3: number;
  entrySpot: number; confidence: number; sentiment: string; status: string;
  exitSpot: number | null; exitPremium: number | null; durationSec: number | null; exitReason: string | null;
  totalPnl: number | null; netPnl: number | null; expiryDate: string | null; regime?: string | null;
  smartFactors?: string | null; entryContext?: EntryContext | null;
}

const FACTOR_LABEL: Record<string, string> = {
  TIMEFRAME_CONSENSUS: "Timeframes", MOMENTUM: "Momentum", VWAP: "VWAP", PCR: "PCR", OI_FLOW: "OI flow",
  GEX: "GEX", SMART_FLOW: "Smart flow", REGIME: "Regime", CROSS_MARKET: "Cross-market", STABILITY: "Stability",
};

const num = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(d));
const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

function Row({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className={cn("text-right font-medium text-slate-200", tone)}>{value}</span>
    </div>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-cyan-400/80">{title}</div>
      {children}
    </div>
  );
}

function parseFactors(raw: string | null | undefined): [string, number][] {
  if (!raw) return [];
  try {
    const obj = JSON.parse(raw);
    return Object.entries(obj as Record<string, unknown>)
      .filter((e): e is [string, number] => typeof e[1] === "number")
      .map(([k, v]) => [k, v] as [string, number]);
  } catch { return []; }
}

export function TradeHoverCard({
  trade, open, onOpenChange, onEnter, onLeave, children,
}: {
  trade: HoverTrade; open: boolean; onOpenChange: (open: boolean) => void;
  onEnter: () => void; onLeave: () => void; children: ReactNode;
}) {
  const ctx = trade.entryContext ?? null;
  const factors = parseFactors(trade.smartFactors);
  const isClosed = trade.status !== "OPEN";
  const source = trade.alertId.startsWith("bg-") ? "Background" : "Dashboard";
  const mins = trade.durationSec !== null ? Math.round(trade.durationSec / 60) : null;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        side="bottom" align="start" sideOffset={6}
        onOpenAutoFocus={e => e.preventDefault()} onCloseAutoFocus={e => e.preventDefault()}
        onMouseEnter={onEnter} onMouseLeave={onLeave}
        className="max-h-[var(--radix-popover-content-available-height)] w-80 space-y-2.5 overflow-y-auto border-[#1c2530] bg-[#0d131b] p-3 text-[11px] text-slate-200 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-100">{trade.symbol} {trade.strike} {trade.optionType}</span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">{source}</span>
        </div>

        <Section title="Trade">
          <Row label="Entry / SL" value={`${num(trade.entryPremium)} / ${num(trade.stopLoss)}`} />
          <Row label="Targets 1 · 2 · 3" value={`${num(trade.target1, 0)} · ${num(trade.target2, 0)} · ${num(trade.target3, 0)}`} />
          <Row label="Spot at entry" value={num(trade.entrySpot)} />
          <Row label="Confidence" value={`${trade.confidence}%`} />
          <Row label="Sentiment / regime" value={`${trade.sentiment}${trade.regime ? ` · ${trade.regime}` : ""}`} />
          {trade.expiryDate && <Row label="Expiry" value={trade.expiryDate} />}
        </Section>

        <Section title="Market at entry">
          {ctx ? (
            <>
              <Row label="Time (IST)" value={hhmm(ctx.istMinute)} />
              <Row label="India VIX" value={num(ctx.vix)} />
              <Row label="PCR" value={num(ctx.pcr)} />
              <Row label="GEX" value={num(ctx.gex)} />
              <Row label="ATM IV" value={ctx.atmIv === null ? "—" : `${num(ctx.atmIv)}%`} />
              <Row label="Signal quality" value={`${ctx.smartQuality} (score ${num(ctx.smartScore, 0)})`} />
              <Row label="Locked for" value={`${ctx.stability} reads`} />
              <Row label="Reward : risk (T1)" value={ctx.rr === null ? "—" : `${ctx.rr} : 1`} />
            </>
          ) : (
            <div className="text-slate-500">Not recorded — this trade was opened before entry context was saved.</div>
          )}
        </Section>

        {factors.length > 0 && (
          <Section title="Signal factors at entry">
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
              {factors.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between">
                  <span className="text-slate-500">{FACTOR_LABEL[k] ?? k}</span>
                  <span className={cn("font-medium", v > 0 ? "text-emerald-400" : v < 0 ? "text-rose-400" : "text-slate-400")}>{v > 0 ? "+" : ""}{Math.round(v)}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {isClosed && (
          <Section title="Exit">
            <Row label="Exit premium / spot" value={`${num(trade.exitPremium)} / ${num(trade.exitSpot)}`} />
            <Row label="Reason" value={trade.exitReason ?? trade.status} />
            {mins !== null && <Row label="Held" value={`${mins} min`} />}
            {trade.netPnl !== null && (
              <Row label="Net P&L" value={`${trade.netPnl >= 0 ? "+" : "−"}₹${Math.abs(trade.netPnl).toFixed(0)}`} tone={trade.netPnl >= 0 ? "text-emerald-400" : "text-rose-400"} />
            )}
          </Section>
        )}
      </PopoverContent>
    </Popover>
  );
}
