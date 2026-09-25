"use client";

import { useState } from "react";
import {
  Activity, CalendarDays, CheckCircle2, CircleHelp, Download, LayoutDashboard,
  Search, ShieldCheck, Sparkles, Target, Wrench, X,
} from "lucide-react";

const updates = [
  {
    version: "v1.0.5",
    date: "24 Sep 2026",
    title: "Smarter Signals + Smoother Updates",
    items: [
      "Added explainable Smart Signal Engine using multi-timeframe consensus, momentum, VWAP, PCR, OI flow, GEX, smart flow, regime, cross-market context and signal stability.",
      "Added Smart Signal panel with score, Bull/Bear edge, confidence, quality, factor breakdown and blockers.",
      "Added in-app Update button with automatic update checking, download progress and Restart & Update flow.",
      "Added Electron auto-update checks at startup and periodically while the app is running.",
      "Fixed Windows build pipeline compatibility with GitHub Actions Node 24 by updating checkout, setup-node and upload-artifact actions.",
      "Fixed a TypeScript build issue in the Yahoo data path so the Smart Signal remains attached to the final snapshot without leaking into SignalContextResult.",
      "Fixed the remaining TypeScript build error by adding smartSignal to the Yahoo OptionChainSnapshot object; this was blocking Windows EXE packaging.",
      "Added repository-wide GitHub Copilot instructions so Copilot/AI agents preserve trading logic, Smart Signal, Windows packaging, security and the mandatory Help & What's New workflow.",
      "Moved the AI / Smart Signal Engine into its own top-level tab beside Dashboard and Option Chain for a cleaner dashboard view.",
      "Version 1.0.3: dedicated AI / Smart Signal tab release; the version bump ensures installed builds can detect this update through the Electron auto-updater.",
      "Moved Check for Updates into the responsive header toolbar so it no longer overlaps other controls.",
    ],
  },
];

const itemIcons = [
  Target, Activity, Download, CheckCircle2, Wrench, ShieldCheck,
  ShieldCheck, Sparkles, LayoutDashboard, Download, Wrench,
];

export function HelpWhatsNew() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const normalizedSearch = search.trim().toLowerCase();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Help & What's New"
        className="fixed right-4 bottom-4 z-[100] inline-flex items-center gap-2 rounded-full border border-cyan-700/50 bg-[#0f1620]/95 px-3 py-2 text-xs font-semibold text-cyan-300 shadow-lg shadow-cyan-950/20 backdrop-blur transition hover:-translate-y-0.5 hover:border-cyan-500/60 hover:bg-[#16202d]"
        aria-label="Open Help & What's New"
      >
        <CircleHelp className="h-4 w-4" />
        Help & What's New
      </button>

      {open && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-5">
          <div className="flex max-h-[min(780px,calc(100vh-1.5rem))] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[#2b3a4b] bg-[#0b1119] shadow-2xl shadow-black/50">
            <div className="relative overflow-hidden border-b border-[#1c2530] bg-gradient-to-br from-cyan-500/10 via-[#0f1620] to-amber-500/10 px-4 py-4 sm:px-6 sm:py-5">
              <div className="absolute -right-12 -top-16 h-40 w-40 rounded-full border border-cyan-400/10" />
              <div className="relative flex items-start justify-between gap-4">
                <div>
                  <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300/80">
                    <Sparkles className="h-3.5 w-3.5 text-amber-300" />
                    Release intelligence
                  </div>
                  <div className="flex items-center gap-2 text-lg font-semibold text-slate-100 sm:text-xl">
                    Help & What's New
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">LIVE</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">A quick read on the latest tools, reliability fixes, and workflow improvements.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="shrink-0 rounded-lg border border-transparent p-2 text-slate-400 transition hover:border-[#334155] hover:bg-[#17212d] hover:text-slate-100"
                  aria-label="Close Help & What's New"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="relative mt-4 grid grid-cols-3 gap-2 sm:gap-3">
                <div className="rounded-lg border border-[#2a3949] bg-[#0b1119]/70 px-2.5 py-2.5 sm:px-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-500"><CalendarDays className="h-3 w-3" /> Latest</div>
                  <div className="mt-1 text-sm font-semibold text-amber-300">{updates[0].version}</div>
                </div>
                <div className="rounded-lg border border-[#2a3949] bg-[#0b1119]/70 px-2.5 py-2.5 sm:px-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-500"><CheckCircle2 className="h-3 w-3" /> Status</div>
                  <div className="mt-1 text-sm font-semibold text-emerald-300">Up to date</div>
                </div>
                <div className="rounded-lg border border-[#2a3949] bg-[#0b1119]/70 px-2.5 py-2.5 sm:px-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-500"><Activity className="h-3 w-3" /> Updates</div>
                  <div className="mt-1 text-sm font-semibold text-cyan-300">{updates[0].items.length} notes</div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 border-b border-[#1c2530] px-4 py-3 sm:px-6">
              <Search className="h-4 w-4 shrink-0 text-slate-500" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search updates..."
                aria-label="Search updates"
                className="min-w-0 flex-1 bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-600"
              />
              {search && <button type="button" onClick={() => setSearch("")} className="rounded p-1 text-slate-500 hover:bg-[#17212d] hover:text-slate-200" aria-label="Clear update search"><X className="h-3.5 w-3.5" /></button>}
            </div>

            <div className="min-h-0 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
              {updates.map((update) => (
                <section key={update.version} className="rounded-xl border border-[#263445] bg-[#0f1620] p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] font-bold text-amber-300">{update.version}</span>
                        <h2 className="font-semibold text-slate-100">{update.title}</h2>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">What changed, at a glance</p>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-500"><CalendarDays className="h-3.5 w-3.5" />{update.date}</div>
                  </div>
                  <ul className="mt-4 space-y-2">
                    {update.items.filter((item) => !normalizedSearch || item.toLowerCase().includes(normalizedSearch)).map((item) => {
                      const Icon = itemIcons[update.items.indexOf(item)] ?? CheckCircle2;
                      return <li key={item} className="group flex gap-3 rounded-lg border border-transparent px-2 py-2 transition hover:border-[#263445] hover:bg-[#121c28]"><span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-cyan-500/20 bg-cyan-500/10 text-cyan-300"><Icon className="h-3.5 w-3.5" /></span><span className="text-[13px] leading-relaxed text-slate-300">{item}</span></li>;
                    })}
                  </ul>
                  {update.items.filter((item) => !normalizedSearch || item.toLowerCase().includes(normalizedSearch)).length === 0 && <div className="rounded-lg border border-dashed border-[#2a3949] px-4 py-8 text-center text-sm text-slate-500">No updates match “{search}”.</div>}
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
