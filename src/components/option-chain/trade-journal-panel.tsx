"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, TrendingDown, Trash2, History, RefreshCw, LogOut, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface TradeEntry {
  id: string; alertId: string; symbol: string; action: string; optionType: string; strike: number;
  entryPremium: number; stopLoss: number; target1: number; target2: number; target3: number;
  entrySpot: number; confidence: number; sentiment: string; rationale: string; status: string;
  exitSpot: number | null; exitPremium: number | null; pnlPerLot: number | null; totalPnl: number | null;
  pnlPercent: number | null; durationSec: number | null; exitReason: string | null;
  openedAt: string; closedAt: string | null; dataSource: string;
}
interface TradeStats { total: number; open: number; closed: number; wins: number; losses: number; winRate: number; totalPnl: number; avgWin: number; avgLoss: number; }

// Lot size isn't stored per-trade (only symbol is) — this mirrors the same
// mapping used when a trade is first opened (see handleAlert in page.tsx),
// so P&L computed here from a manual exit matches what the app would have
// computed itself.
function lotSizeFor(symbol: string) { return symbol === "BANKNIFTY" ? 30 : symbol === "SENSEX" ? 20 : 65; }

const RESULT_STYLE: Record<string, { label: string; text: string }> = {
  OPEN: { label: "Open", text: "text-cyan-300" },
  TARGET1_HIT: { label: "Target 1 hit", text: "text-emerald-300" },
  TARGET2_HIT: { label: "Target 2 hit", text: "text-emerald-400" },
  TARGET3_HIT: { label: "Target 3 hit", text: "text-emerald-400" },
  SL_HIT: { label: "SL hit", text: "text-rose-300" },
  MANUAL_CLOSE: { label: "Closed manually", text: "text-slate-300" },
  EOD_SQUAREOFF: { label: "EOD square-off (3:15 PM)", text: "text-amber-300" },
};

async function fetchTrades(filters: { period: string; result: string; symbol: string; action: string; source: string }): Promise<{ trades: TradeEntry[]; stats: TradeStats }> {
  const params = new URLSearchParams({ limit: "200" });
  if (filters.period !== "all") params.set("period", filters.period);
  if (filters.result !== "all") params.set("result", filters.result);
  if (filters.symbol !== "ALL") params.set("symbol", filters.symbol);
  if (filters.action !== "ALL") params.set("action", filters.action);
  if (filters.source !== "all") params.set("source", filters.source);
  const res = await fetch(`/api/trade-journal?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed"); return res.json();
}

interface TradeJournalPanelProps {
  currentSpot?: number; onExternalClose?: (alertId: string) => void;
  // Live LTP for the currently-viewed symbol's own trade (from the
  // dashboard's live-tick tracking) and for other symbols' background
  // trades (from the multi-symbol watcher) — see page.tsx. Used only to
  // populate the LTP column for OPEN rows; closed rows show their
  // recorded exit price instead, which is already exact.
  activeTradeLtp?: { alertId: string; ltp: number } | null;
  watchLtpBySymbol?: Record<string, number>;
}

export function TradeJournalPanel({ currentSpot, onExternalClose, activeTradeLtp, watchLtpBySymbol }: TradeJournalPanelProps) {
  const queryClient = useQueryClient();
  const [confirmClear, setConfirmClear] = useState(false);
  const [exitTarget, setExitTarget] = useState<TradeEntry | null>(null);
  const [exitPriceInput, setExitPriceInput] = useState("");
  const [period, setPeriod] = useState("all");
  const [result, setResult] = useState("all");
  const [symbolFilter, setSymbolFilter] = useState("ALL");
  const [actionFilter, setActionFilter] = useState("ALL");
  const [sourceFilter, setSourceFilter] = useState("all");
  const filters = { period, result, symbol: symbolFilter, action: actionFilter, source: sourceFilter };
  const filtersActive = period !== "all" || result !== "all" || symbolFilter !== "ALL" || actionFilter !== "ALL" || sourceFilter !== "all";
  const { data, isLoading, refetch, isFetching } = useQuery({ queryKey: ["trade-journal", filters], queryFn: () => fetchTrades(filters), refetchInterval: 5000, staleTime: 3000 });
  const clearMutation = useMutation({
    mutationFn: async () => { const res = await fetch("/api/trade-journal?confirm=DELETE", { method: "DELETE" }); if (!res.ok) throw new Error("Failed"); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["trade-journal"] }); setConfirmClear(false); },
  });
  const exitMutation = useMutation({
    mutationFn: async ({ trade, exitPremium }: { trade: TradeEntry; exitPremium: number }) => {
      const lotSize = lotSizeFor(trade.symbol);
      const pnlPerLot = exitPremium - trade.entryPremium;
      const totalPnl = pnlPerLot * lotSize;
      const pnlPercent = (pnlPerLot / trade.entryPremium) * 100;
      const durationSec = Math.round((Date.now() - new Date(trade.openedAt).getTime()) / 1000);
      const res = await fetch(`/api/trade-journal/${trade.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "MANUAL_CLOSE", exitReason: "Closed manually from Trade Journal", exitPremium, exitSpot: currentSpot ?? trade.entrySpot, pnlPerLot, totalPnl, pnlPercent, durationSec }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || "Failed"); }
      return { trade, ...(await res.json()) };
    },
    onSuccess: (_, { trade }) => {
      queryClient.invalidateQueries({ queryKey: ["trade-journal"] });
      queryClient.invalidateQueries({ queryKey: ["trade-journal-today"] });
      // If this row happens to be the trade the dashboard is currently
      // tracking as "Active", tell the parent so it can clear that state too
      // — otherwise the Active Trade card keeps showing a position that's
      // already closed here, which is exactly the kind of disconnect that
      // caused confusion earlier in this app.
      onExternalClose?.(trade.alertId);
      setExitTarget(null); setExitPriceInput("");
    },
  });
  const trades = data?.trades ?? [];
  const stats = data?.stats ?? { total: 0, open: 0, closed: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0, avgWin: 0, avgLoss: 0 };
  const pnlPositive = stats.totalPnl >= 0;

  return (
    <Card className="bg-[#0f1620] border-[#1c2530] p-3">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2"><History className="h-4 w-4 text-amber-400" /><h3 className="text-sm font-semibold text-slate-200">Trade Journal</h3><Badge variant="outline" className="text-[10px] font-mono bg-[#0a0e14] border-[#1c2530] text-slate-400">{stats.total} total</Badge>{isFetching && <RefreshCw className="h-3 w-3 animate-spin text-slate-500" />}</div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-slate-400 hover:text-slate-100" onClick={() => refetch()}><RefreshCw className="h-3 w-3 mr-1" />Refresh</Button>
          <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-rose-400 hover:text-rose-300 hover:bg-rose-950/30" disabled={trades.length === 0} onClick={() => setConfirmClear(true)}><Trash2 className="h-3 w-3 mr-1" />Clear All</Button>
            <DialogContent className="bg-[#0f1620] border-[#1c2530] text-slate-200"><DialogHeader><DialogTitle className="text-rose-300">Clear all {stats.total} trade records?</DialogTitle><DialogDescription className="text-slate-400">This permanently deletes every trade in the journal including closed trades. This action cannot be undone.</DialogDescription></DialogHeader><DialogFooter><DialogClose asChild><Button variant="outline" size="sm" className="bg-[#0a0e14] border-[#1c2530] text-slate-300">Cancel</Button></DialogClose><Button size="sm" onClick={() => clearMutation.mutate()} disabled={clearMutation.isPending} className="bg-rose-700 hover:bg-rose-600 text-white">{clearMutation.isPending ? "Deleting…" : "Delete All"}</Button></DialogFooter></DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3 pb-3 border-b border-[#1c2530]">
        <span className="flex items-center gap-1 text-[11px] text-slate-500"><Filter className="h-3 w-3" />Filters:</span>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="h-7 w-[120px] text-[11px] bg-[#0a0e14] border-[#1c2530] text-slate-300"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-[#0d1219] border-[#1c2530] text-slate-200">
            <SelectItem value="all">All Time</SelectItem>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="7d">Last 7 Days</SelectItem>
            <SelectItem value="30d">Last 30 Days</SelectItem>
            <SelectItem value="month">This Month</SelectItem>
          </SelectContent>
        </Select>
        <Select value={result} onValueChange={setResult}>
          <SelectTrigger className="h-7 w-[110px] text-[11px] bg-[#0a0e14] border-[#1c2530] text-slate-300"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-[#0d1219] border-[#1c2530] text-slate-200">
            <SelectItem value="all">Win/Loss: All</SelectItem>
            <SelectItem value="win">Wins Only</SelectItem>
            <SelectItem value="loss">Losses Only</SelectItem>
            <SelectItem value="open">Open Only</SelectItem>
          </SelectContent>
        </Select>
        <Select value={symbolFilter} onValueChange={setSymbolFilter}>
          <SelectTrigger className="h-7 w-[110px] text-[11px] bg-[#0a0e14] border-[#1c2530] text-slate-300"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-[#0d1219] border-[#1c2530] text-slate-200">
            <SelectItem value="ALL">All Symbols</SelectItem>
            <SelectItem value="NIFTY">NIFTY</SelectItem>
            <SelectItem value="BANKNIFTY">BANKNIFTY</SelectItem>
            <SelectItem value="SENSEX">SENSEX</SelectItem>
          </SelectContent>
        </Select>
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="h-7 w-[100px] text-[11px] bg-[#0a0e14] border-[#1c2530] text-slate-300"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-[#0d1219] border-[#1c2530] text-slate-200">
            <SelectItem value="ALL">CE / PE</SelectItem>
            <SelectItem value="BUY CE">CE only</SelectItem>
            <SelectItem value="BUY PE">PE only</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="h-7 w-[130px] text-[11px] bg-[#0a0e14] border-[#1c2530] text-slate-300"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-[#0d1219] border-[#1c2530] text-slate-200">
            <SelectItem value="all">Live + Background</SelectItem>
            <SelectItem value="live">Live Only</SelectItem>
            <SelectItem value="background">Background Only</SelectItem>
          </SelectContent>
        </Select>
        {filtersActive && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-slate-500 hover:text-slate-200" onClick={() => { setPeriod("all"); setResult("all"); setSymbolFilter("ALL"); setActionFilter("ALL"); setSourceFilter("all"); }}>
            Reset
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
        <StatBox label="Open" value={stats.open.toString()} color="text-cyan-300" border="border-cyan-700/40" bg="bg-cyan-500/5" />
        <StatBox label="Closed" value={stats.closed.toString()} color="text-slate-300" border="border-slate-700/40" bg="bg-slate-500/5" />
        <StatBox label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} sub={`${stats.wins}W / ${stats.losses}L`} color={stats.winRate >= 50 ? "text-emerald-400" : "text-rose-400"} border="border-amber-700/40" bg="bg-amber-500/5" />
        <StatBox label="Total P&L" value={`${pnlPositive ? "+" : "−"}₹${Math.abs(stats.totalPnl).toFixed(0)}`} sub={`avg win ₹${stats.avgWin.toFixed(0)} / loss ₹${stats.avgLoss.toFixed(0)}`} color={pnlPositive ? "text-emerald-400" : "text-rose-400"} border={pnlPositive ? "border-emerald-700/40" : "border-rose-700/40"} bg={pnlPositive ? "bg-emerald-500/5" : "bg-rose-500/5"} />
        <StatBox label="Best Outcome" value={trades.find(t => t.status === "TARGET3_HIT") ? "T3" : trades.find(t => t.status === "TARGET2_HIT") ? "T2" : trades.find(t => t.status === "TARGET1_HIT") ? "T1" : stats.closed > 0 ? "T1 / SL" : "—"} color="text-amber-400" border="border-amber-700/40" bg="bg-amber-500/5" />
      </div>
      {isLoading ? <div className="text-center py-6 text-slate-500 text-sm">Loading trades…</div> : trades.length === 0 ? <div className="text-center py-6 text-slate-500"><History className="h-7 w-7 mx-auto mb-2 opacity-30" /><p className="text-sm">{filtersActive ? "No trades match these filters" : "No trades recorded yet"}</p><p className="text-[11px] mt-1">{filtersActive ? "Try Reset to see everything again" : "Trades appear here automatically when a stable signal triggers an alert"}</p></div> : (
        <ScrollArea className="max-h-[440px]">
          <table className="w-full text-[13px] font-mono border-collapse">
            <thead>
              <tr className="text-slate-500 text-[11px] uppercase tracking-wider border-b border-[#1c2530]">
                <th className="text-left font-normal py-2 pr-2">S.No.</th>
                <th className="text-left font-normal py-2 pr-2">Date</th>
                <th className="text-left font-normal py-2 pr-2">Time</th>
                <th className="text-left font-normal py-2 pr-2">Index</th>
                <th className="text-right font-normal py-2 pr-2">Strike</th>
                <th className="text-left font-normal py-2 pr-2">Type</th>
                <th className="text-right font-normal py-2 pr-1">Entry</th>
                <th className="text-right font-normal py-2 pr-2">LTP</th>
                <th className="text-right font-normal py-2 pr-2">SL</th>
                <th className="text-right font-normal py-2 pr-6">Exit price</th>
                <th className="text-left font-normal py-2 pr-2">Result</th>
                <th className="text-right font-normal py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => <TradeRow key={t.id} sno={i + 1} trade={t} onExitClick={() => { setExitTarget(t); setExitPriceInput(String(t.entryPremium)); }} liveLtp={t.alertId === activeTradeLtp?.alertId ? activeTradeLtp?.ltp : watchLtpBySymbol?.[t.symbol]} />)}
            </tbody>
          </table>
        </ScrollArea>
      )}

      <Dialog open={!!exitTarget} onOpenChange={(open) => { if (!open) { setExitTarget(null); setExitPriceInput(""); } }}>
        <DialogContent className="bg-[#0f1620] border-[#1c2530] text-slate-200">
          <DialogHeader>
            <DialogTitle>Exit trade</DialogTitle>
            <DialogDescription className="text-slate-400">
              {exitTarget && <>{exitTarget.action} {exitTarget.strike} {exitTarget.optionType} · {exitTarget.symbol} · entry ₹{exitTarget.entryPremium}. Enter the price you actually exited at.</>}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">Exit price</Label>
            <Input type="number" step="0.01" value={exitPriceInput} onChange={e => setExitPriceInput(e.target.value)} className="bg-[#0a0e14] border-[#1c2530] font-mono" autoFocus />
            {exitTarget && exitPriceInput !== "" && !isNaN(Number(exitPriceInput)) && (
              <p className={cn("text-[11px] font-mono pt-1", Number(exitPriceInput) >= exitTarget.entryPremium ? "text-emerald-400" : "text-rose-400")}>
                P&L: {Number(exitPriceInput) >= exitTarget.entryPremium ? "+" : "−"}₹{Math.abs((Number(exitPriceInput) - exitTarget.entryPremium) * lotSizeFor(exitTarget.symbol)).toFixed(0)} ({(((Number(exitPriceInput) - exitTarget.entryPremium) / exitTarget.entryPremium) * 100).toFixed(1)}%)
              </p>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" size="sm" className="bg-[#0a0e14] border-[#1c2530] text-slate-300">Cancel</Button></DialogClose>
            <Button size="sm" disabled={!exitTarget || exitPriceInput === "" || isNaN(Number(exitPriceInput)) || exitMutation.isPending} onClick={() => exitTarget && exitMutation.mutate({ trade: exitTarget, exitPremium: Number(exitPriceInput) })} className="bg-rose-700 hover:bg-rose-600 text-white">
              {exitMutation.isPending ? "Closing…" : "Confirm exit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function StatBox({ label, value, sub, color, border, bg }: { label: string; value: string; sub?: string; color: string; border: string; bg: string }) {
  return <div className={cn("rounded-md border px-3 py-2", bg, border)}><div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div><div className={cn("font-mono text-base font-bold mt-0.5", color)}>{value}</div>{sub && <div className="text-[10px] text-slate-500 font-mono mt-0.5">{sub}</div>}</div>;
}

function TradeRow({ trade, sno, onExitClick, liveLtp }: { trade: TradeEntry; sno: number; onExitClick: () => void; liveLtp?: number }) {
  const isBull = trade.action === "BUY CE"; const isOpen = trade.status === "OPEN";
  const result = RESULT_STYLE[trade.status] ?? RESULT_STYLE.OPEN;
  const pnl = trade.totalPnl ?? 0; const pnlPositive = pnl >= 0;
  const opened = new Date(trade.openedAt);
  const dateStr = opened.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  const timeStr = opened.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
  // LTP column: live price while OPEN (from the dashboard's own tracking
  // or the background watcher — see page.tsx), the recorded exit price
  // once closed (that's the real, exact price it actually left at, no
  // reason to keep guessing after the fact).
  const ltpValue = isOpen ? liveLtp : trade.exitPremium ?? undefined;
  const ltpUp = ltpValue != null && ltpValue >= trade.entryPremium;
  return (
    <tr className={cn("border-b border-[#1c2530]/60 hover:bg-[#0a0e14]/60", isOpen && "bg-cyan-500/[0.03]")}>
      <td className="py-2 pr-2 text-slate-500">{sno}</td>
      <td className="py-2 pr-2 text-slate-400">{dateStr}</td>
      <td className="py-2 pr-2 text-slate-400">{timeStr}</td>
      <td className="py-2 pr-2 text-slate-300">{trade.symbol}</td>
      <td className="py-2 pr-2 text-right text-amber-300 font-semibold">{trade.strike}</td>
      <td className="py-2 pr-2">
        <span className={cn("inline-flex items-center gap-1 font-bold", isBull ? "text-emerald-300" : "text-rose-300")}>
          {isBull ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}{trade.optionType}
        </span>
      </td>
      <td className="py-2 pr-1 text-right text-cyan-300">{trade.entryPremium.toFixed(2)}</td>
      <td className={cn("py-2 pr-2 text-right", ltpValue == null ? "text-slate-600" : ltpUp ? "text-emerald-400" : "text-rose-400")}>
        {ltpValue != null ? ltpValue.toFixed(2) : isOpen ? "…" : "—"}
      </td>
      <td className="py-2 pr-2 text-right text-rose-300">{trade.stopLoss.toFixed(2)}</td>
      <td className="py-2 pr-6 text-right text-slate-300">{trade.exitPremium !== null ? trade.exitPremium.toFixed(2) : "—"}</td>
      <td className="py-2 pr-2">
        <div className={cn("font-semibold", result.text)}>{result.label}</div>
        {!isOpen && trade.totalPnl !== null && <div className={cn("text-[11px]", pnlPositive ? "text-emerald-400" : "text-rose-400")}>{pnlPositive ? "+" : "−"}₹{Math.abs(pnl).toFixed(0)}{trade.pnlPercent !== null && ` (${pnlPositive ? "+" : ""}${trade.pnlPercent.toFixed(1)}%)`}</div>}
      </td>
      <td className="py-2 text-right">
        {isOpen && <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] bg-[#0a0e14] border-rose-800/40 text-rose-300 hover:bg-rose-950/40" onClick={onExitClick}><LogOut className="h-2.5 w-2.5 mr-1" />Exit</Button>}
      </td>
    </tr>
  );
}
