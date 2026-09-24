"use client";

import { useState } from "react";
import { CircleHelp, Sparkles, X } from "lucide-react";

const updates = [
  {
    version: "v1.0.2",
    date: "24 Sep 2026",
    title: "Smart Signal + Auto Update",
    items: [
      "Added explainable Smart Signal Engine using multi-timeframe consensus, momentum, VWAP, PCR, OI flow, GEX, smart flow, regime, cross-market context and signal stability.",
      "Added Smart Signal panel with score, Bull/Bear edge, confidence, quality, factor breakdown and blockers.",
      "Added in-app Update button with automatic update checking, download progress and Restart & Update flow.",
      "Added Electron auto-update checks at startup and periodically while the app is running.",
      "Fixed Windows build pipeline compatibility with GitHub Actions Node 24 by updating checkout, setup-node and upload-artifact actions.",
      "Fixed a TypeScript build issue in the Yahoo data path so the Smart Signal remains attached to the final snapshot without leaking into SignalContextResult.",
      "Fixed the remaining TypeScript build error by adding smartSignal to the Yahoo OptionChainSnapshot object; this was blocking Windows EXE packaging.",
    ],
  },
];

export function HelpWhatsNew() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-4 z-[100] inline-flex items-center gap-2 rounded-full border border-cyan-700/50 bg-[#0f1620]/95 px-3 py-2 text-xs font-medium text-cyan-300 shadow-lg backdrop-blur hover:bg-[#16202d]"
        title="Help & What's New"
      >
        <CircleHelp className="h-4 w-4" />
        Help & What's New
      </button>

      {open && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[80vh] overflow-hidden rounded-xl border border-[#273241] bg-[#0b1119] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#1c2530] px-5 py-4">
              <div>
                <div className="flex items-center gap-2 text-base font-semibold text-slate-100">
                  <Sparkles className="h-4 w-4 text-amber-400" />
                  Help & What's New
                </div>
                <p className="mt-0.5 text-xs text-slate-500">Latest app changes and important features</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[65vh] overflow-y-auto p-5 space-y-5">
              {updates.map((update) => (
                <section key={update.version} className="rounded-lg border border-[#1c2530] bg-[#0f1620] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold text-amber-300">{update.version} · {update.title}</div>
                    <div className="text-[11px] font-mono text-slate-500">{update.date}</div>
                  </div>
                  <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-300">
                    {update.items.map((item) => <li key={item} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />{item}</li>)}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
