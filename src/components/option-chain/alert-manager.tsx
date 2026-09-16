"use client";
import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Bell, BellRing, Volume2, VolumeX, Play, Settings2, TrendingUp, TrendingDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { isPastNewEntryCutoff } from "@/lib/market-hours";

export interface AlertConfig {
  enabled: boolean; soundEnabled: boolean; threshold: number; cooldownSec: number;
  alertOnBull: boolean; alertOnBear: boolean; requireAllTimeframesAgree: boolean; requireStableSignal: boolean;
  minRiskReward: number; requireLiquidity: boolean;
  maxTradesPerDay: number; blockWhileTradeActive: boolean;
  avoidRangebound: boolean;
  enableDailyLossLimit: boolean; dailyLossLimit: number;
  cooloffAfterLossMin: number;
}
const DEFAULT_CONFIG: AlertConfig = { enabled: true, soundEnabled: true, threshold: 78, cooldownSec: 60, alertOnBull: true, alertOnBear: true, requireAllTimeframesAgree: false, requireStableSignal: true, minRiskReward: 1.3, requireLiquidity: true, maxTradesPerDay: 2, blockWhileTradeActive: true, avoidRangebound: true, enableDailyLossLimit: true, dailyLossLimit: 2000, cooloffAfterLossMin: 15 };
const STORAGE_KEY = "ocp-alert-config";
function loadConfig(): AlertConfig { if (typeof window === "undefined") return DEFAULT_CONFIG; try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : DEFAULT_CONFIG; } catch { return DEFAULT_CONFIG; } }
function saveConfig(c: AlertConfig) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); } catch {} }

export interface AlertEvent { id: string; ts: number; action: "BUY CE" | "BUY PE"; confidence: number; symbol: string; strike: number; entry: number; stopLoss: number; target1: number; target2: number; target3: number; riskReward: number; reasoning: string; }

interface AlertManagerProps { config: AlertConfig; onConfigChange: (c: AlertConfig) => void; onPreviewSound: () => void; lastAlert: AlertEvent | null; onDismissAlert: () => void; tradesToday: number; }

export function AlertManager({ config, onConfigChange, onPreviewSound, lastAlert, onDismissAlert, tradesToday }: AlertManagerProps) {
  const update = (patch: Partial<AlertConfig>) => { const next = { ...config, ...patch }; onConfigChange(next); saveConfig(next); };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("bg-[#0f1620] border-[#1c2530] text-slate-300 hover:text-slate-100 hover:bg-[#1a2230]", config.enabled && "border-amber-700/40 text-amber-400")}>
          {config.enabled ? <BellRing className="h-3.5 w-3.5 mr-1" /> : <Bell className="h-3.5 w-3.5 mr-1" />}
          Alerts {config.enabled ? "ON" : "OFF"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 bg-[#0f1620] border-[#1c2530] text-slate-200 p-4" align="end">
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <div><div className="text-sm font-semibold flex items-center gap-1.5"><Settings2 className="h-4 w-4" /> Alert Settings</div><p className="text-[11px] text-slate-500 mt-0.5">Trigger on high-confidence signals</p></div>
            <Badge variant="outline" className={cn("font-mono text-[10px] shrink-0", tradesToday >= config.maxTradesPerDay ? "bg-rose-500/10 text-rose-400 border-rose-700/40" : "bg-slate-500/10 text-slate-400 border-slate-600/40")}>
              {tradesToday}/{config.maxTradesPerDay} today
            </Badge>
          </div>
          <div className="flex items-center justify-between rounded-md bg-[#0a0e14] px-3 py-2 border border-[#1c2530]"><Label className="text-xs">Enable alerts</Label><Switch checked={config.enabled} onCheckedChange={v => update({ enabled: v })} /></div>
          <div className="flex items-center justify-between rounded-md bg-[#0a0e14] px-3 py-2 border border-[#1c2530]"><Label className="text-xs flex items-center gap-1.5">{config.soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />} Sound alert</Label><div className="flex items-center gap-2"><Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-slate-400 hover:text-slate-100" onClick={onPreviewSound}><Play className="h-3 w-3 mr-0.5" /> Test</Button><Switch checked={config.soundEnabled} onCheckedChange={v => update({ soundEnabled: v })} /></div></div>
          <div className="rounded-md bg-[#0a0e14] px-3 py-2 border border-amber-700/30"><div className="flex items-center justify-between mb-2"><Label className="text-xs">Max trades per day</Label><Badge variant="outline" className="font-mono text-[10px] bg-amber-500/10 text-amber-400 border-amber-700/40">{config.maxTradesPerDay === 99 ? "Unlimited" : config.maxTradesPerDay}</Badge></div><Slider value={[config.maxTradesPerDay]} min={1} max={10} step={1} onValueChange={([v]) => update({ maxTradesPerDay: v })} /><div className="flex justify-between text-[10px] text-slate-500 mt-1"><span>1 (very selective)</span><span>10 (loose)</span></div><p className="text-[10px] text-slate-500 mt-1.5">Once this many alerts have fired today, no more alerts until tomorrow — even if a high-confidence signal appears.</p></div>
          <div className="flex items-center justify-between rounded-md bg-[#0a0e14] px-3 py-2 border border-amber-700/30"><div><Label className="text-xs">Only one trade at a time</Label><p className="text-[10px] text-slate-500 mt-0.5">Don&apos;t alert while a trade is already active — wait for it to hit SL/Target before considering the next setup</p></div><Switch checked={config.blockWhileTradeActive} onCheckedChange={v => update({ blockWhileTradeActive: v })} /></div>
          <div className="flex items-center justify-between rounded-md bg-[#0a0e14] px-3 py-2 border border-[#1c2530]"><div><Label className="text-xs">Avoid rangebound market</Label><p className="text-[10px] text-slate-500 mt-0.5">Skip alerts when regime is RANGEBOUND — directional option buying has a weaker edge when price is chopping sideways and theta just eats the premium</p></div><Switch checked={config.avoidRangebound} onCheckedChange={v => update({ avoidRangebound: v })} /></div>
          <div className="rounded-md bg-[#0a0e14] px-3 py-2 border border-[#1c2530] space-y-2">
            <div className="flex items-center justify-between"><div><Label className="text-xs">Daily loss circuit breaker</Label><p className="text-[10px] text-slate-500 mt-0.5">Stop generating new alerts for the day once today&apos;s realized loss crosses this</p></div><Switch checked={config.enableDailyLossLimit} onCheckedChange={v => update({ enableDailyLossLimit: v })} /></div>
            {config.enableDailyLossLimit && (<><div className="flex items-center justify-between"><Label className="text-[11px] text-slate-400">Max loss per day</Label><Badge variant="outline" className="font-mono text-[10px] bg-rose-500/10 text-rose-400 border-rose-700/40">₹{config.dailyLossLimit}</Badge></div><Slider value={[config.dailyLossLimit]} min={500} max={10000} step={500} onValueChange={([v]) => update({ dailyLossLimit: v })} /></>)}
          </div>
          <div className="rounded-md bg-[#0a0e14] px-3 py-2 border border-[#1c2530]"><div className="flex items-center justify-between mb-2"><Label className="text-xs">Cool-off after a loss</Label><Badge variant="outline" className="font-mono text-[10px] bg-cyan-500/10 text-cyan-400 border-cyan-700/40">{config.cooloffAfterLossMin === 0 ? "Off" : `${config.cooloffAfterLossMin} min`}</Badge></div><Slider value={[config.cooloffAfterLossMin]} min={0} max={60} step={5} onValueChange={([v]) => update({ cooloffAfterLossMin: v })} /><p className="text-[10px] text-slate-500 mt-1.5">After an SL hits, wait this long before the next alert — avoids immediately re-entering a similar setup that just failed.</p></div>
          <div className="rounded-md bg-[#0a0e14] px-3 py-2 border border-[#1c2530]"><div className="flex items-center justify-between mb-2"><Label className="text-xs">Confidence threshold</Label><Badge variant="outline" className="font-mono text-[10px] bg-amber-500/10 text-amber-400 border-amber-700/40">{config.threshold}%</Badge></div><Slider value={[config.threshold]} min={50} max={95} step={5} onValueChange={([v]) => update({ threshold: v })} /><div className="flex justify-between text-[10px] text-slate-500 mt-1"><span>50% (loose)</span><span>95% (strict)</span></div></div>
          <div className="rounded-md bg-[#0a0e14] px-3 py-2 border border-[#1c2530]"><div className="flex items-center justify-between mb-2"><Label className="text-xs">Min. risk:reward (target 2)</Label><Badge variant="outline" className="font-mono text-[10px] bg-violet-500/10 text-violet-400 border-violet-700/40">1:{config.minRiskReward.toFixed(1)}</Badge></div><Slider value={[config.minRiskReward]} min={1} max={3} step={0.1} onValueChange={([v]) => update({ minRiskReward: v })} /><div className="flex justify-between text-[10px] text-slate-500 mt-1"><span>1:1 (loose)</span><span>1:3 (strict)</span></div><p className="text-[10px] text-slate-500 mt-1.5">A high-confidence signal with a poor risk:reward still won&apos;t alert.</p></div>
          <div className="rounded-md bg-[#0a0e14] px-3 py-2 border border-[#1c2530]"><div className="flex items-center justify-between mb-2"><Label className="text-xs">Cooldown between alerts</Label><Badge variant="outline" className="font-mono text-[10px] bg-cyan-500/10 text-cyan-400 border-cyan-700/40">{config.cooldownSec}s</Badge></div><Slider value={[config.cooldownSec]} min={15} max={300} step={15} onValueChange={([v]) => update({ cooldownSec: v })} /><div className="flex justify-between text-[10px] text-slate-500 mt-1"><span>15s (frequent)</span><span>5min (rare)</span></div></div>
          <div className="rounded-md bg-[#0a0e14] px-3 py-2 border border-[#1c2530] space-y-2"><Label className="text-xs">Alert me on</Label><div className="flex items-center justify-between"><span className="text-[11px] flex items-center gap-1.5 text-emerald-400"><TrendingUp className="h-3.5 w-3.5" /> BUY CE (bullish)</span><Switch checked={config.alertOnBull} onCheckedChange={v => update({ alertOnBull: v })} /></div><div className="flex items-center justify-between"><span className="text-[11px] flex items-center gap-1.5 text-rose-400"><TrendingDown className="h-3.5 w-3.5" /> BUY PE (bearish)</span><Switch checked={config.alertOnBear} onCheckedChange={v => update({ alertOnBear: v })} /></div></div>
          <div className="flex items-center justify-between rounded-md bg-[#0a0e14] px-3 py-2 border border-[#1c2530]"><div><Label className="text-xs">Require all timeframes agree</Label><p className="text-[10px] text-slate-500 mt-0.5">5m + 15m + 30m must show same signal</p></div><Switch checked={config.requireAllTimeframesAgree} onCheckedChange={v => update({ requireAllTimeframesAgree: v })} /></div>
          <div className="flex items-center justify-between rounded-md bg-[#0a0e14] px-3 py-2 border border-[#1c2530]"><div><Label className="text-xs">Require stable signal</Label><p className="text-[10px] text-slate-500 mt-0.5">Signal must persist 3 refreshes before alerting</p></div><Switch checked={config.requireStableSignal} onCheckedChange={v => update({ requireStableSignal: v })} /></div>
          <div className="flex items-center justify-between rounded-md bg-[#0a0e14] px-3 py-2 border border-[#1c2530]"><div><Label className="text-xs">Require liquidity</Label><p className="text-[10px] text-slate-500 mt-0.5">Skip alerts when today&apos;s volume at that strike is too thin (&lt;{500})</p></div><Switch checked={config.requireLiquidity} onCheckedChange={v => update({ requireLiquidity: v })} /></div>
          {lastAlert && <div className="border-t border-[#1c2530] pt-3"><div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Last alert</div><div className="text-[11px] text-slate-400 font-mono">{new Date(lastAlert.ts).toLocaleTimeString("en-IN", { hour12: false })} · {lastAlert.symbol} {lastAlert.action} {lastAlert.strike} @ {lastAlert.confidence}%</div><Button size="sm" variant="ghost" className="h-7 mt-2 text-[11px] text-slate-400 w-full" onClick={onDismissAlert}>Dismiss banner</Button></div>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface UseAlertEngineArgs {
  config: AlertConfig;
  snapshot: { action: "BUY CE" | "BUY PE" | "WAIT" | "EXIT" | null; confidence: number; symbol: string; strike: number; entry: number; stopLoss: number; target1: number; target2: number; target3: number; riskReward: number; lowLiquidity: boolean; reasoning: string; tf5: string; tf15: string; tf30: string; regime: string; } | null;
  stability?: { isLocked: boolean; consecutiveCount: number; } | null;
  tradesToday: number;
  hasActiveTrade: boolean;
  todayPnl: number;
  lastLossClosedAt: number | null;
  onAlert: (event: AlertEvent) => void;
}

export function useAlertEngine({ config, snapshot, stability, tradesToday, hasActiveTrade, todayPnl, lastLossClosedAt, onAlert }: UseAlertEngineArgs) {
  const lastBullRef = useRef(0); const lastBearRef = useRef(0);
  const firingLockRef = useRef(false);

  // hasActiveTrade going false (trade closed) is the signal that it's safe
  // to consider firing again — release the lock exactly then, not on a timer.
  useEffect(() => { if (!hasActiveTrade) firingLockRef.current = false; }, [hasActiveTrade]);

  useEffect(() => {
    if (!config.enabled || !snapshot) return;
    if (!snapshot.action || snapshot.action === "WAIT" || snapshot.action === "EXIT") return;
    const now = Date.now(); const isBull = snapshot.action === "BUY CE"; const isBear = snapshot.action === "BUY PE";
    if (isBull && !config.alertOnBull) return; if (isBear && !config.alertOnBear) return;
    if (snapshot.confidence < config.threshold) return;
    if (snapshot.riskReward < config.minRiskReward) return;
    if (config.requireLiquidity && snapshot.lowLiquidity) return;
    if (config.requireAllTimeframesAgree) { const t = snapshot.action; if (snapshot.tf5 !== t || snapshot.tf15 !== t || snapshot.tf30 !== t) return; }
    if (config.requireStableSignal) { if (!stability || !stability.isLocked) return; }
    // No new entries from 3:15 PM IST onward — the exact same cutoff the
    // EOD square-off itself uses to force-close open trades. A signal
    // firing right before (or after) that point would just get force-shut
    // again almost immediately, with no real room to play out.
    if (isPastNewEntryCutoff()) return;
    // These are what actually keep trade count sane and each trade a
    // genuinely distinct setup, rather than the cooldown alone (which just
    // re-fires the *same* still-valid signal every cooldownSec while it
    // persists — that's what produced multiple near-identical entries for
    // the same strike/entry/SL within minutes of each other).
    if (config.blockWhileTradeActive && hasActiveTrade) return;
    if (tradesToday >= config.maxTradesPerDay) return;
    // Quality filters — these reject setups that pass the confidence/RR bar
    // but are still statistically weak contexts to buy options in.
    if (config.avoidRangebound && snapshot.regime === "RANGEBOUND") return;
    if (config.enableDailyLossLimit && todayPnl <= -Math.abs(config.dailyLossLimit)) return;
    if (config.cooloffAfterLossMin > 0 && lastLossClosedAt != null && now - lastLossClosedAt < config.cooloffAfterLossMin * 60 * 1000) return;
    // Ref lock: set synchronously the instant we commit to firing, so a
    // second refresh tick arriving before React re-renders with the new
    // activeTrade state (a real possibility on a 5s auto-refresh) can't
    // slip through and fire an effectively-duplicate alert for the exact
    // same setup a few seconds later.
    if (firingLockRef.current) return;
    const lastTs = isBull ? lastBullRef.current : lastBearRef.current;
    if (now - lastTs < config.cooldownSec * 1000) return;
    firingLockRef.current = true;
    if (isBull) lastBullRef.current = now; else lastBearRef.current = now;
    onAlert({ id: `${now}-${Math.random().toString(36).slice(2, 8)}`, ts: now, action: snapshot.action, confidence: snapshot.confidence, symbol: snapshot.symbol, strike: snapshot.strike, entry: snapshot.entry, stopLoss: snapshot.stopLoss, target1: snapshot.target1, target2: snapshot.target2, target3: snapshot.target3, riskReward: snapshot.riskReward, reasoning: snapshot.reasoning });
  }, [config, snapshot, stability, tradesToday, hasActiveTrade, todayPnl, lastLossClosedAt, onAlert]);
}

export function useAlertConfig() {
  const [config, setConfig] = useState<AlertConfig>(() => typeof window === "undefined" ? DEFAULT_CONFIG : loadConfig());
  return [config, setConfig] as const;
}
