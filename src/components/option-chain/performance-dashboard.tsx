"use client";

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Loader2, TrendingUp, TrendingDown, Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface Bucket { label: string; total: number; wins: number; winRate: number; totalPnl: number }
interface HourBucket extends Bucket { hour: number }

interface CalibrationBucket {
  label: string; lo: number; hi: number; total: number; wins: number; winRate: number;
  avgStatedConfidence: number; gap: number; verdict: "well-calibrated" | "overconfident" | "underconfident" | "insufficient-data";
}

interface StatsResponse {
  hasData: boolean;
  minSampleSize: number;
  overall?: {
    total: number; wins: number; losses: number; winRate: number;
    totalPnl: number; avgWin: number; avgLoss: number; avgDurationSec: number | null;
  };
  byRegime?: Bucket[];
  byConfidence?: Bucket[];
  byAction?: Bucket[];
  calibration?: CalibrationBucket[];
  bestHours?: HourBucket[];
  worstHours?: HourBucket[];
}

function fmtDuration(sec: number | null): string {
  if (sec == null) return "—";
  const m = Math.round(sec / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function WinRateBar({ winRate }: { winRate: number }) {
  const color = winRate >= 60 ? "bg-emerald-500" : winRate >= 45 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="h-1.5 w-full rounded-full bg-[#1c2530] overflow-hidden">
      <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.min(100, winRate)}%` }} />
    </div>
  );
}

function BucketRow({ b }: { b: Bucket }) {
  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-slate-300 font-medium">{b.label}</span>
        <span className="text-slate-400 font-mono">
          {b.wins}/{b.total} · <span className={b.winRate >= 50 ? "text-emerald-400" : "text-rose-400"}>{b.winRate}%</span>
          <span className={cn("ml-2", b.totalPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>₹{b.totalPnl >= 0 ? "+" : ""}{b.totalPnl}</span>
        </span>
      </div>
      <WinRateBar winRate={b.winRate} />
    </div>
  );
}

export function PerformanceDashboard({ symbol }: { symbol?: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    const qs = symbol ? `?symbol=${encodeURIComponent(symbol)}` : "";
    fetch(`/api/trade-journal/stats${qs}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
        return res.json();
      })
      .then(setStats)
      .catch((err) => setError(err.message || "Failed to load performance stats"))
      .finally(() => setLoading(false));
  }, [open, symbol]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="px-2.5 h-8 rounded text-[11px] font-semibold transition-colors flex items-center gap-1.5 text-slate-400 hover:text-slate-200 border border-[#1c2530]">
          <BarChart3 className="h-3.5 w-3.5" /> Performance
        </button>
      </DialogTrigger>
      <DialogContent className="bg-[#0d1219] border-[#1c2530] text-slate-200 max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-100">
            <BarChart3 className="h-4 w-4 text-cyan-400" /> Performance Dashboard
          </DialogTitle>
          <DialogDescription className="text-slate-400 text-xs">
            Computed from your own closed trades in the Trade Journal — not a prediction, a record of what's actually happened.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-10 text-slate-500 text-sm gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}

        {!loading && error && (
          <div className="rounded-md border border-rose-700/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>
        )}

        {!loading && !error && stats && !stats.hasData && (
          <div className="rounded-md border border-[#1c2530] bg-[#0a0e14] px-3 py-4 text-xs text-slate-400 text-center">
            No closed trades yet. Once a few trades finish (SL/target hit or manually closed), stats show up here.
          </div>
        )}

        {!loading && !error && stats?.hasData && stats.overall && (
          <div className="space-y-5">
            {/* Overall */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-[#1c2530] bg-[#0a0e14] px-3 py-2">
                <div className="text-[10px] text-slate-500 uppercase tracking-wide">Win Rate</div>
                <div className={cn("text-lg font-mono font-semibold", stats.overall.winRate >= 50 ? "text-emerald-400" : "text-rose-400")}>
                  {stats.overall.winRate}%
                </div>
                <div className="text-[10px] text-slate-500">{stats.overall.wins}W / {stats.overall.losses}L of {stats.overall.total}</div>
              </div>
              <div className="rounded-md border border-[#1c2530] bg-[#0a0e14] px-3 py-2">
                <div className="text-[10px] text-slate-500 uppercase tracking-wide">Total P&L</div>
                <div className={cn("text-lg font-mono font-semibold", stats.overall.totalPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
                  ₹{stats.overall.totalPnl >= 0 ? "+" : ""}{stats.overall.totalPnl}
                </div>
                <div className="text-[10px] text-slate-500">avg win ₹{stats.overall.avgWin} · avg loss ₹{stats.overall.avgLoss}</div>
              </div>
            </div>
            {stats.overall.avgDurationSec != null && (
              <div className="text-[11px] text-slate-500">Avg trade duration: <span className="text-slate-300">{fmtDuration(stats.overall.avgDurationSec)}</span></div>
            )}

            {/* By regime */}
            {stats.byRegime && stats.byRegime.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold text-slate-300 mb-1.5">By Market Regime</div>
                <div className="divide-y divide-[#1c2530]/60">
                  {stats.byRegime.map(b => <BucketRow key={b.label} b={b} />)}
                </div>
              </div>
            )}

            {/* Confidence calibration — is "80%" actually 80%? */}
            {stats.calibration && stats.calibration.some(c => c.verdict !== "insufficient-data") && (
              <div>
                <div className="text-[11px] font-semibold text-slate-300 mb-1.5 flex items-center gap-1">
                  Confidence Calibration
                  <span className="text-slate-600" title="Does the app's stated confidence actually match how often those trades win?"><Info className="h-3 w-3" /></span>
                </div>
                <div className="space-y-1.5">
                  {stats.calibration.filter(c => c.verdict !== "insufficient-data").map(c => (
                    <div key={c.label} className="flex items-center justify-between text-xs rounded-md border border-[#1c2530] bg-[#0a0e14] px-2.5 py-1.5">
                      <span className="text-slate-300 font-medium">{c.label} stated</span>
                      <span className="flex items-center gap-2 font-mono">
                        <span className="text-slate-500">→ won {c.winRate}%</span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px]",
                            c.verdict === "well-calibrated" && "bg-emerald-500/10 text-emerald-300 border-emerald-700/40",
                            c.verdict === "overconfident" && "bg-rose-500/10 text-rose-300 border-rose-700/40",
                            c.verdict === "underconfident" && "bg-amber-500/10 text-amber-300 border-amber-700/40"
                          )}
                        >
                          {c.verdict === "well-calibrated" ? "well-calibrated" : c.verdict === "overconfident" ? `${Math.abs(c.gap)}pt overconfident` : `${Math.abs(c.gap)}pt underconfident`}
                        </Badge>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-slate-600 mt-1.5">
                  Bands showing "overconfident" or "underconfident" (off by more than 7 points) are already being partially corrected in live signals — see "Calibration:" notes in a trade's rationale.
                </div>
              </div>
            )}

            {/* By confidence */}
            {stats.byConfidence && stats.byConfidence.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold text-slate-300 mb-1.5">By Signal Confidence</div>
                <div className="divide-y divide-[#1c2530]/60">
                  {stats.byConfidence.map(b => <BucketRow key={b.label} b={b} />)}
                </div>
              </div>
            )}

            {/* By action */}
            {stats.byAction && stats.byAction.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold text-slate-300 mb-1.5">BUY CE vs BUY PE</div>
                <div className="divide-y divide-[#1c2530]/60">
                  {stats.byAction.map(b => <BucketRow key={b.label} b={b} />)}
                </div>
              </div>
            )}

            {/* Best/worst hours */}
            {((stats.bestHours && stats.bestHours.length > 0) || (stats.worstHours && stats.worstHours.length > 0)) && (
              <div>
                <div className="text-[11px] font-semibold text-slate-300 mb-1.5 flex items-center gap-1">
                  Time of Day
                  <span className="text-slate-600" title={`Only hours with ${stats.minSampleSize}+ trades shown`}><Info className="h-3 w-3" /></span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] text-emerald-400 flex items-center gap-1 mb-1"><TrendingUp className="h-3 w-3" /> Best</div>
                    {stats.bestHours?.map(h => (
                      <div key={h.hour} className="text-[11px] text-slate-400 flex justify-between py-0.5">
                        <span>{h.label} IST</span><span className="text-emerald-400">{h.winRate}%</span>
                      </div>
                    ))}
                    {(!stats.bestHours || stats.bestHours.length === 0) && <div className="text-[10px] text-slate-600">Not enough data per hour yet</div>}
                  </div>
                  <div>
                    <div className="text-[10px] text-rose-400 flex items-center gap-1 mb-1"><TrendingDown className="h-3 w-3" /> Worst</div>
                    {stats.worstHours?.map(h => (
                      <div key={h.hour} className="text-[11px] text-slate-400 flex justify-between py-0.5">
                        <span>{h.label} IST</span><span className="text-rose-400">{h.winRate}%</span>
                      </div>
                    ))}
                    {(!stats.worstHours || stats.worstHours.length === 0) && <div className="text-[10px] text-slate-600">Not enough data per hour yet</div>}
                  </div>
                </div>
              </div>
            )}

            <div className="text-[10px] text-slate-600 border-t border-[#1c2530] pt-2">
              Breakdowns only show buckets with at least {stats.minSampleSize} trades — small samples are hidden rather than shown as misleadingly precise percentages. Regime data only exists for trades logged after this feature was added.
            </div>
            <Badge variant="outline" className="text-[10px] font-mono bg-cyan-500/10 text-cyan-300 border-cyan-700/40">
              Signals with {stats.minSampleSize}+ matching past trades now get their confidence nudged by this same data — see a trade's rationale for "Adaptive:" notes.
            </Badge>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
