"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { OptionChainRow } from "@/lib/types";
import { cn } from "@/lib/utils";

interface OptionChainTableProps {
  rows: OptionChainRow[];
  spot: number;
}

function formatOi(n: number): string {
  if (Math.abs(n) >= 100000) return `${(n / 100000).toFixed(2)}L`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return `${n}`;
}

function oiBarWidth(oi: number, maxOi: number): number {
  return Math.min(100, (oi / Math.max(1, maxOi)) * 100);
}

export function OptionChainTable({ rows: allRows, spot }: OptionChainTableProps) {
  // Show only ATM ± 5 strikes here — brokers often return 20-40+ strikes,
  // which is more than useful for a quick-glance table. PCR/Max Pain/GEX
  // elsewhere in the app still use the full chain for accuracy; this
  // trimming is purely for this display.
  const rows = (() => {
    const atmIdx = allRows.findIndex((r) => r.isATM);
    if (atmIdx === -1) {
      // Fallback: no row flagged ATM (shouldn't normally happen) — pick
      // the strike closest to the real spot price instead.
      const closestIdx = allRows.reduce((best, r, i) => Math.abs(r.strike - spot) < Math.abs(allRows[best].strike - spot) ? i : best, 0);
      return allRows.slice(Math.max(0, closestIdx - 5), closestIdx + 6);
    }
    return allRows.slice(Math.max(0, atmIdx - 5), atmIdx + 6);
  })();

  const maxOi = Math.max(
    ...rows.map((r) => Math.max(r.ceOi, r.peOi))
  );

  return (
    <div className="bg-[#0f1620] border border-[#1c2530] rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-[#1c2530] flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">
            Live Option Chain
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Open Interest buildup around ATM · Green = addition, Red = unwinding
          </p>
        </div>
        <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-slate-500">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded bg-rose-500/60" /> Call side
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded bg-emerald-500/60" /> Put side
          </span>
        </div>
      </div>

      <ScrollArea className="max-h-[420px]">
        <Table>
          <TableHeader className="sticky top-0 bg-[#0a0e14] z-10">
            <TableRow className="border-[#1c2530] hover:bg-transparent">
              <TableHead className="text-rose-400 text-[10px] uppercase tracking-wider text-center">
                OI Chg
              </TableHead>
              <TableHead className="text-rose-400 text-[10px] uppercase tracking-wider text-center">
                OI
              </TableHead>
              <TableHead className="text-rose-400 text-[10px] uppercase tracking-wider text-center">
                IV
              </TableHead>
              <TableHead className="text-rose-400 text-[10px] uppercase tracking-wider text-center">
                LTP
              </TableHead>
              <TableHead className="text-amber-400 text-[10px] uppercase tracking-wider text-center font-bold">
                Strike
              </TableHead>
              <TableHead className="text-emerald-400 text-[10px] uppercase tracking-wider text-center">
                LTP
              </TableHead>
              <TableHead className="text-emerald-400 text-[10px] uppercase tracking-wider text-center">
                IV
              </TableHead>
              <TableHead className="text-emerald-400 text-[10px] uppercase tracking-wider text-center">
                OI
              </TableHead>
              <TableHead className="text-emerald-400 text-[10px] uppercase tracking-wider text-center">
                OI Chg
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const isATM = row.isATM;
              const isITMCall = row.strike < spot;
              const isITMPut = row.strike > spot;

              return (
                <TableRow
                  key={row.strike}
                  className={cn(
                    "border-[#1c2530] hover:bg-[#1a2230] transition-colors",
                    isATM && "bg-amber-500/10 border-y-2 border-y-amber-500/50 hover:bg-amber-500/15"
                  )}
                >
                  {/* CE side */}
                  <TableCell
                    className={cn(
                      "font-mono text-[11px] text-center",
                      row.ceOiChg > 0
                        ? "text-emerald-400"
                        : row.ceOiChg < 0
                        ? "text-rose-400"
                        : "text-slate-500"
                    )}
                  >
                    {row.ceOiChg > 0 ? "+" : ""}
                    {formatOi(row.ceOiChg)}
                  </TableCell>
                  <TableCell className="p-0">
                    <div className="relative h-9 flex flex-col items-end justify-center pr-2 py-0.5">
                      <div
                        className="absolute right-0 top-0 bottom-0 bg-rose-500/15"
                        style={{
                          width: `${oiBarWidth(row.ceOi, maxOi)}%`,
                        }}
                      />
                      <span className="relative font-mono text-[11px] text-slate-300">
                        {formatOi(row.ceOi)}
                      </span>
                      {row.ceVolume !== undefined && (
                        <span className={cn("relative font-mono text-[9px] flex items-center gap-1", row.ceVolume < 500 ? "text-amber-500" : "text-slate-600")} title="Volume traded today">
                          {row.ceVolume < 500 && <span className="h-1 w-1 rounded-full bg-amber-500" />}
                          Vol {formatOi(row.ceVolume)}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "font-mono text-[11px] text-center",
                      isITMCall ? "text-slate-400" : "text-slate-600"
                    )}
                  >
                    {row.ceIv}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "font-mono text-[11px] text-center",
                      isITMCall ? "text-rose-300" : "text-slate-500"
                    )}
                  >
                    {row.ceLtp}
                  </TableCell>

                  {/* Strike (center) */}
                  <TableCell
                    className={cn(
                      "font-mono text-xs text-center font-bold",
                      isATM ? "text-amber-400" : "text-slate-300"
                    )}
                  >
                    <div className="flex items-center justify-center gap-1.5">
                      {row.strike}
                      {isATM && (
                        <span className="text-[9px] font-sans font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40 rounded px-1 py-0.5 leading-none">
                          ATM
                        </span>
                      )}
                    </div>
                  </TableCell>

                  {/* PE side */}
                  <TableCell
                    className={cn(
                      "font-mono text-[11px] text-center",
                      isITMPut ? "text-emerald-300" : "text-slate-500"
                    )}
                  >
                    {row.peLtp}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "font-mono text-[11px] text-center",
                      isITMPut ? "text-slate-400" : "text-slate-600"
                    )}
                  >
                    {row.peIv}
                  </TableCell>
                  <TableCell className="p-0">
                    <div className="relative h-9 flex flex-col items-start justify-center pl-2 py-0.5">
                      <div
                        className="absolute left-0 top-0 bottom-0 bg-emerald-500/15"
                        style={{
                          width: `${oiBarWidth(row.peOi, maxOi)}%`,
                        }}
                      />
                      <span className="relative font-mono text-[11px] text-slate-300">
                        {formatOi(row.peOi)}
                      </span>
                      {row.peVolume !== undefined && (
                        <span className={cn("relative font-mono text-[9px] flex items-center gap-1", row.peVolume < 500 ? "text-amber-500" : "text-slate-600")} title="Volume traded today">
                          {row.peVolume < 500 && <span className="h-1 w-1 rounded-full bg-amber-500" />}
                          Vol {formatOi(row.peVolume)}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "font-mono text-[11px] text-center",
                      row.peOiChg > 0
                        ? "text-emerald-400"
                        : row.peOiChg < 0
                        ? "text-rose-400"
                        : "text-slate-500"
                    )}
                  >
                    {row.peOiChg > 0 ? "+" : ""}
                    {formatOi(row.peOiChg)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}
