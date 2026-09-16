"use client";
import { AlertTriangle, KeyRound } from "lucide-react";

interface Props {
  variant: "not-configured" | "error";
  message?: string;
  onRetry?: () => void;
  isRetrying?: boolean;
}

export function NoDataBanner({ variant, message, onRetry, isRetrying }: Props) {
  const isNotConfigured = variant === "not-configured";
  return (
    <div className="max-w-[1600px] w-full mx-auto px-4 sm:px-6 pt-5">
      <div className="rounded-lg border-2 border-rose-700/60 bg-rose-950/30 p-5 flex flex-col sm:flex-row items-start gap-4">
        <div className="h-11 w-11 rounded-lg bg-rose-500/20 border border-rose-700/40 flex items-center justify-center shrink-0">
          {isNotConfigured ? <KeyRound className="h-6 w-6 text-rose-400" /> : <AlertTriangle className="h-6 w-6 text-rose-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold text-rose-300">
            {isNotConfigured ? "No broker connected — showing nothing until real data is available" : "Real market data unavailable right now"}
          </h2>
          <p className="text-sm text-slate-400 mt-1 leading-relaxed">
            {isNotConfigured
              ? "This app only ever shows real, broker-sourced option chain data — it never falls back to simulated or estimated numbers. Click \"API Keys\" above to connect a broker (ICICI, Angel One, Dhan, or Groww) and get real prices, OI, PCR, and trade signals."
              : (message || "The connection to your broker (or the underlying market data feed) failed. No trade signals or alerts will fire until this is resolved.")}
          </p>
          <p className="text-[12px] text-amber-400/90 mt-2 font-medium">No trade alerts will fire while real data is unavailable.</p>
          {!isNotConfigured && onRetry && (
            <button onClick={onRetry} disabled={isRetrying} className="mt-3 text-xs font-semibold px-3 py-1.5 rounded-md bg-rose-600/20 border border-rose-700/50 text-rose-300 hover:bg-rose-600/30 transition-colors disabled:opacity-50">
              {isRetrying ? "Retrying…" : "Retry now"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
