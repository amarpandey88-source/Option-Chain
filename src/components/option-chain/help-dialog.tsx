"use client";

import { useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  HelpCircle, BookOpen, Link2, KeyRound, LayoutDashboard, Radio, Radar, BellRing,
  ListChecks, BarChart3, AlertTriangle, LifeBuoy, ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Section {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  body: React.ReactNode;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] text-slate-300 leading-relaxed mb-2.5">{children}</p>;
}
function UL({ children }: { children: React.ReactNode }) {
  return <ul className="space-y-1.5 mb-3 ml-1">{children}</ul>;
}
function LI({ children }: { children: React.ReactNode }) {
  return (
    <li className="text-[13px] text-slate-300 leading-relaxed flex gap-2">
      <span className="text-amber-500 mt-1.5 h-1 w-1 rounded-full bg-amber-500 shrink-0" />
      <span>{children}</span>
    </li>
  );
}
function B({ children }: { children: React.ReactNode }) {
  return <span className="text-slate-100 font-medium">{children}</span>;
}
function Code({ children }: { children: React.ReactNode }) {
  return <code className="text-[12px] font-mono text-cyan-300 bg-[#0a0e14] border border-[#1c2530] rounded px-1.5 py-0.5">{children}</code>;
}
function Sub({ children }: { children: React.ReactNode }) {
  return <h4 className="text-[13px] font-semibold text-amber-400 mt-3 mb-1.5">{children}</h4>;
}
function TableBox({ rows }: { rows: [string, string][] }) {
  return (
    <div className="rounded-md border border-[#1c2530] overflow-hidden mb-3">
      {rows.map(([a, b], i) => (
        <div key={i} className={cn("flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 px-3 py-2 text-[12.5px]", i % 2 === 0 ? "bg-[#0a0e14]" : "bg-[#0d1219]")}>
          <div className="sm:w-[38%] text-slate-100 font-medium shrink-0">{a}</div>
          <div className="text-slate-400">{b}</div>
        </div>
      ))}
    </div>
  );
}

const SECTIONS: Section[] = [
  {
    id: "modes", title: "1. Two Data Modes", icon: Link2,
    body: (
      <>
        <P>The app can run in two modes, switchable anytime from the header toggle.</P>
        <TableBox rows={[
          ["NSE (View) — grey button", "Yahoo Finance, free, no login needed. Spot price and India VIX are real; the option chain (OI, PCR, Max Pain, GEX) is simulated since Yahoo doesn't provide real option data."],
          ["Broker — purple, shows broker name (e.g. FYERS)", "Real spot price, real VIX, real option-chain OI — so PCR, Max Pain, and GEX are 100% real. Also enables trade alerts, the Trade Journal, and everything downstream of a real trade firing."],
        ]} />
        <P>The app <B>defaults to Broker mode automatically</B> the first time a broker is connected. If you manually switch back to NSE mode, that choice is remembered.</P>
        <P>Trade alerts only fire in Broker mode — NSE mode is for market-structure viewing only.</P>
      </>
    ),
  },
  {
    id: "fyers", title: "2. Connecting Fyers", icon: KeyRound,
    body: (
      <>
        <P>Click <B>API Keys</B> in the header.</P>
        <Sub>One-time setup (do this once, ever)</Sub>
        <UL>
          <LI>Create an app at <B>myapi.fyers.in/dashboard</B>.</LI>
          <LI>Set the app's <B>Redirect URL</B> to exactly: <Code>http://127.0.0.1:3000/api/broker-config/fyers/callback</Code></LI>
          <LI>Copy the <B>App ID</B> and <B>Secret ID</B> into the API Keys dialog.</LI>
        </UL>
        <Sub>Every day after that</Sub>
        <UL>
          <LI>Click <B>Connect via Fyers Login</B> — a small in-app window opens (not your system browser), you log in, and the access token saves itself automatically. No manual copy-pasting.</LI>
          <LI>Fyers tokens expire once a day (Fyers' own rule) — if you ever see a <Code>401 / Please provide valid token</Code> error, this is why. Just click Connect via Fyers Login again.</LI>
        </UL>
      </>
    ),
  },
  {
    id: "dashboard", title: "3. Reading the Dashboard", icon: LayoutDashboard,
    body: (
      <>
        <Sub>Top metrics</Sub>
        <UL>
          <LI><B>PCR</B> (Put-Call Ratio), <B>Max Pain</B>, <B>GEX</B> (Gamma Exposure) — real when in Broker mode.</LI>
          <LI><B>India VIX</B>, <B>Smart Flow</B> (net OI change direction), <B>Trend Score</B>, <B>Bull/Bear Probability</B>.</LI>
          <LI><B>Support / Resistance</B> — derived from where real Put/Call OI is concentrated.</LI>
          <LI><B>Regime</B> — TRENDING UP, TRENDING DOWN, RANGEBOUND, or VOLATILE, based on VIX and trend strength.</LI>
        </UL>
        <Sub>The Signal</Sub>
        <P>Computed across 5-min / 15-min / 30-min timeframes (RSI, EMA cross, momentum, VWAP bias, PCR trend, OI-flow bias), then combined into one overall signal: <Code>BUY CE</Code>, <Code>BUY PE</Code>, or <Code>WAIT</Code>.</P>
        <P>Confidence adjustments applied on top, in this order:</P>
        <UL>
          <LI><B>Regime</B> — Rangebound/Volatile regimes trim confidence (chop/whipsaw risk).</LI>
          <LI><B>Expiry day</B> — trims confidence (erratic gamma/theta near expiry).</LI>
          <LI><B>Bank Nifty confirmation</B> — opposing Bank Nifty trend trims confidence; agreement gives a small boost.</LI>
          <LI><B>Confidence calibration</B> — checks whether your own history at this confidence level actually won that often, and corrects toward reality once there's enough data (see §8).</LI>
          <LI><B>Adaptive (regime × action) nudge</B> — how this exact action-in-this-regime combo has performed in your own trade history.</LI>
          <LI>If confidence falls under <B>55%</B> after all adjustments, the signal downgrades to WAIT automatically.</LI>
        </UL>
        <Sub>Signal Stability</Sub>
        <P>A signal needs to stay consistent across consecutive refreshes before it's considered "locked" (🔒) — filters out noisy, flip-flopping signals from firing trades.</P>
        <Sub>Entry Strike — ITM, not ATM</Sub>
        <UL>
          <LI>The suggested trade strike is <B>one strike ITM</B> of ATM — higher delta means the same underlying move produces a bigger premium gain.</LI>
          <LI>Entry price uses the real last-traded price (LTP) when available; falls back to a theoretical Black-Scholes price only if no real LTP exists yet.</LI>
          <LI>Stop-loss / Target 1 are sized off real VIX and delta, with a fixed 1:2 risk-reward.</LI>
        </UL>
        <Sub>No new entries near close</Sub>
        <P>No new trade — on any symbol, live or background — fires from <B>3:15 PM IST</B> onward. That's the same moment open trades get force-closed (see §7), so there's never a fresh entry with no real time left to play out.</P>
      </>
    ),
  },
  {
    id: "livetick", title: "4. Live Tick Tracking", icon: Radio,
    body: (
      <>
        <P>While a trade is open, the app subscribes to that one option's <B>real-time tick stream</B> from Fyers (not the whole chain) via a WebSocket — for every open trade, not just the one you're currently looking at. This means SL/Target hits are detected the instant they happen, not just at the next poll.</P>
        <UL>
          <LI><B>● LIVE TICK</B> badge = tick stream connected, instant detection.</LI>
          <LI><B>◌ POLLING</B> badge = falling back to the normal refresh interval (still works, just slightly less instant).</LI>
        </UL>
      </>
    ),
  },
  {
    id: "multisymbol", title: "5. Multi-Symbol Background Watching", icon: Radar,
    body: (
      <>
        <P>The dashboard only shows one symbol at a time — but a background watcher inside the app continuously tracks <B>all three</B> (NIFTY, BANKNIFTY, SENSEX) every 20 seconds, independent of what's on screen.</P>
        <UL>
          <LI>Whichever symbol you're actively viewing is left to the dashboard's own faster live-tick monitoring.</LI>
          <LI>The other two are managed entirely by the background watcher: if either produces a high-confidence (75%+) and stable/locked signal, it automatically fires a trade — logs it, sends alerts, and later closes it (SL/Target/EOD) on its own.</LI>
          <LI>If <B>more than one symbol</B> qualifies in the same 20-second cycle, only the single highest-confidence one is taken — not both at once. The other can still fire on a later cycle if it's still the best candidate then.</LI>
          <LI>Discipline rules apply before firing: a daily trade cap per symbol, a loss circuit-breaker, a cool-off after a loss, and skipping rangebound/thin-liquidity setups.</LI>
          <LI>A small strip under the header shows their live status without switching tabs.</LI>
        </UL>
      </>
    ),
  },
  {
    id: "alerts", title: "6. Alerts — Even When the App Isn't Open", icon: BellRing,
    body: (
      <>
        <Sub>Telegram</Sub>
        <P>Click <B>Telegram</B> in the header:</P>
        <UL>
          <LI>Message <B>@BotFather</B> on Telegram → <Code>/newbot</Code> → copy the token.</LI>
          <LI>Message <B>@userinfobot</B> to get your numeric Chat ID.</LI>
          <LI>Message your new bot once (so it's allowed to reply to you).</LI>
          <LI>Paste both into the dialog and save.</LI>
        </UL>
        <P>You'll get a Telegram message for every entry, SL hit, target hit, and EOD square-off — including background-fired trades on symbols you weren't viewing.</P>
        <Sub>Desktop notifications + background mode</Sub>
        <UL>
          <LI>Closing the app window <B>doesn't quit it</B> — it minimizes to the system tray and keeps running (and watching) in the background.</LI>
          <LI>Right-click the tray icon to reopen or fully Quit.</LI>
          <LI>OS-level toast notifications fire for the same events as Telegram, as long as the app process is still running (even if the window is hidden).</LI>
        </UL>
        <div className="rounded-md border border-amber-700/40 bg-amber-500/10 px-3 py-2 text-[12.5px] text-amber-200 flex gap-2 mt-2">
          <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
          This only works while your PC is on and the app is running (in the tray or open). If the PC itself is off, nothing local can alert you — that needs a separate always-on server, which isn't part of this app.
        </div>
      </>
    ),
  },
  {
    id: "journal", title: "7. Active Trades & Trade Journal", icon: ListChecks,
    body: (
      <>
        <Sub>Active Trade(s) panel</Sub>
        <P>Every currently open trade shows here — live-monitored for whatever symbol you're viewing, plus any background-fired trades on other symbols — all in one place. Entry, current LTP, P&L, SL/Target distance, and a live/polling badge for each.</P>
        <Sub>Trade Journal</Sub>
        <P>Every trade — yours or background-fired — logs here automatically. Columns include Entry, <B>LTP</B> (live price while OPEN; the exact recorded exit price once closed), SL, Exit price, Result, and P&L. You can manually Exit any open row from here too.</P>
        <Sub>Filters</Sub>
        <UL>
          <LI><B>Period</B> — All Time / Today / Last 7 Days / Last 30 Days / This Month.</LI>
          <LI><B>Win/Loss</B> — All / Wins Only / Losses Only / Open Only.</LI>
          <LI><B>Symbol</B>, <B>CE/PE</B>, and <B>Live vs Background</B> (your own trades vs the watcher's auto-fired ones).</LI>
          <LI>The win-rate/P&L stats above the table update to match whatever filters are active.</LI>
        </UL>
        <Sub>End-of-day square-off</Sub>
        <P>Every open trade — yours or background-fired — is auto-closed at <B>3:15 PM IST</B>, 15 minutes before market close, rather than being held into the final volatile minutes.</P>
      </>
    ),
  },
  {
    id: "performance", title: "8. Performance Dashboard", icon: BarChart3,
    body: (
      <>
        <P>Click <B>Performance</B> next to the Dashboard/Option Chain tabs. Computed entirely from your own closed trades:</P>
        <UL>
          <LI><B>Overall</B> — win rate, total P&L, avg win/loss, avg trade duration.</LI>
          <LI><B>By Regime</B> — which market regime you actually do best in.</LI>
          <LI><B>Confidence Calibration</B> — does "80% confidence" actually win ~80% of the time? Bands off by more than 7 points are flagged and, once a band has 8+ trades, that gap is automatically corrected in future live signals.</LI>
          <LI><B>By Confidence Bucket</B>, <B>By Action</B> (CE vs PE), <B>Best/Worst Hours of Day</B>.</LI>
        </UL>
        <P>All breakdowns require a minimum sample size (8 trades) before showing — small samples are hidden rather than shown as misleadingly precise percentages.</P>
      </>
    ),
  },
  {
    id: "troubleshooting", title: "9. Troubleshooting", icon: AlertTriangle,
    body: (
      <TableBox rows={[
        ["401 Please provide valid token", "Fyers token expired (happens daily) — reconnect via API Keys → Connect via Fyers Login. If it persists even right after a fresh login, test the token directly against Fyers' API (outside this app) to isolate whether it's an account-side issue."],
        ["Fyers login popup shows blank screen", "Usually a 127.0.0.1 vs localhost mismatch, or a wrong Redirect URL on the Fyers dashboard app — double-check it matches exactly."],
        ["\"Real market data unavailable\" banner", "Broker call failed (often the token issue above) — click Retry now, or check the Fyers dashboard app's permissions include Historical Data / Quotes and market data."],
        ["Live tick badge always shows \"POLLING\"", "SL/Target detection still works at the normal refresh interval — check the server console for [fyers-tick-stream] DEBUG lines to see exactly where the live connection is failing."],
        ["Trades firing right before/after 3:15 PM", "Shouldn't happen — new entries are blocked from 3:15 PM IST onward on every symbol. If seen, it's worth a closer look."],
      ]} />
    ),
  },
  {
    id: "limitations", title: "10. Honest Limitations", icon: LifeBuoy,
    body: (
      <>
        <UL>
          <LI><B>NSE mode's option chain is simulated.</B> For real PCR/Max Pain/GEX, connect a broker.</LI>
          <LI><B>Background alerts need the app running</B> (even just in the tray) — they don't work if the PC is fully off.</LI>
          <LI><B>Calibration and adaptive-confidence corrections need real trade history</B> (8+ trades per bucket) before they do anything — they're silent until then.</LI>
        </UL>
        <P>This app is a <B>decision-support tool</B>, not investment advice. Every number it shows is built from real formulas and real data where available, but options trading carries real risk regardless of what any dashboard says.</P>
      </>
    ),
  },
];

export function HelpDialog() {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const contentRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const scrollTo = (id: string) => {
    setActiveId(id);
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="px-2.5 h-8 rounded text-[11px] font-semibold transition-colors flex items-center gap-1.5 text-slate-400 hover:text-slate-200 border border-[#1c2530]">
          <HelpCircle className="h-3.5 w-3.5" /> Help
        </button>
      </DialogTrigger>
      <DialogContent className="bg-[#0d1219] border-[#1c2530] text-slate-200 max-w-4xl w-[95vw] h-[85vh] p-0 gap-0 flex flex-col">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-[#1c2530] shrink-0">
          <DialogTitle className="flex items-center gap-2 text-slate-100">
            <BookOpen className="h-4 w-4 text-amber-400" /> Option Chain Pulse — Manual
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 min-h-0">
          {/* Index / table of contents */}
          <nav className="w-[220px] shrink-0 border-r border-[#1c2530] overflow-y-auto py-3 px-2 hidden sm:block">
            {SECTIONS.map(s => {
              const Icon = s.icon;
              return (
                <button
                  key={s.id}
                  onClick={() => scrollTo(s.id)}
                  className={cn(
                    "w-full text-left flex items-center gap-2 px-2.5 py-2 rounded text-[12px] transition-colors mb-0.5",
                    activeId === s.id ? "bg-amber-500/10 text-amber-400" : "text-slate-400 hover:text-slate-200 hover:bg-[#0f1620]"
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{s.title}</span>
                </button>
              );
            })}
          </nav>

          {/* Content */}
          <div ref={contentRef} className="flex-1 overflow-y-auto px-5 py-4">
            {SECTIONS.map(s => {
              const Icon = s.icon;
              return (
                <div key={s.id} ref={(el) => { sectionRefs.current[s.id] = el; }} className="mb-8 scroll-mt-2">
                  <div className="flex items-center gap-2 mb-3">
                    <Icon className="h-4 w-4 text-amber-400" />
                    <h3 className="text-sm font-semibold text-slate-100">{s.title}</h3>
                  </div>
                  {s.body}
                </div>
              );
            })}
            <div className="text-center pt-2 pb-4">
              <Badge variant="outline" className="text-[10px] font-mono bg-[#0a0e14] text-slate-500 border-[#1c2530]">
                Option Chain Pulse · decision-support tool, not investment advice
              </Badge>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
