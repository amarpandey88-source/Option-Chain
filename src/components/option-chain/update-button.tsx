"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Download, RefreshCw, RotateCcw, XCircle } from "lucide-react";

type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "downloaded" | "up-to-date" | "error" | "dev";
type UpdaterApi = {
  checkForUpdates: () => Promise<{ ok: boolean; status: string; message?: string }>;
  installUpdate: () => Promise<{ ok: boolean; status: string }>;
  onStatus: (callback: (payload: { status: UpdateStatus; version?: string; percent?: number; message?: string }) => void) => () => void;
};

declare global {
  interface Window { optionChainPulseUpdater?: UpdaterApi; }
}

export function UpdateButton() {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [version, setVersion] = useState<string>();
  const [percent, setPercent] = useState(0);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    const api = window.optionChainPulseUpdater;
    if (!api) return;
    return api.onStatus((payload) => {
      setStatus(payload.status);
      if (payload.version) setVersion(payload.version);
      if (payload.percent != null) setPercent(payload.percent);
      if (payload.message) setMessage(payload.message);
    });
  }, []);

  const check = async () => {
    const api = window.optionChainPulseUpdater;
    if (!api) {
      setStatus("error");
      setMessage("Update controls are available in the installed Windows EXE.");
      return;
    }
    setStatus("checking");
    setMessage(undefined);
    const result = await api.checkForUpdates();
    if (!result.ok && result.status !== "dev") {
      setStatus("error");
      setMessage(result.message || "Update check failed.");
    } else if (result.status === "dev") {
      setStatus("dev");
      setMessage(result.message);
    }
  };

  const install = async () => {
    const api = window.optionChainPulseUpdater;
    if (!api) return;
    setStatus("downloading");
    await api.installUpdate();
  };

  const label =
    status === "checking" ? "Checking…" :
    status === "downloading" ? `Downloading ${percent}%` :
    status === "downloaded" ? `Restart & Update${version ? ` v${version}` : ""}` :
    status === "up-to-date" ? "Up to date" :
    status === "available" ? `Update available${version ? ` v${version}` : ""}` :
    status === "error" ? "Update check failed" :
    status === "dev" ? "Installed app only" :
    "Check Update";

  const clickable = status === "downloaded" ? install : check;
  const disabled = status === "checking" || status === "downloading";
  const icon =
    status === "downloaded" ? <RotateCcw className="h-3.5 w-3.5" /> :
    status === "up-to-date" ? <CheckCircle2 className="h-3.5 w-3.5" /> :
    status === "error" ? <XCircle className="h-3.5 w-3.5" /> :
    status === "downloading" ? <Download className="h-3.5 w-3.5 animate-pulse" /> :
    <RefreshCw className={`h-3.5 w-3.5 ${status === "checking" ? "animate-spin" : ""}`} />;

  return (
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={clickable} disabled={disabled}
        title={message || "Check GitHub Releases for a newer Option Chain Pulse version"}
        className="inline-flex items-center gap-1.5 rounded-md border border-cyan-700/50 bg-cyan-500/10 px-2.5 py-1.5 text-[11px] font-medium text-cyan-300 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60">
        {icon}<span>{label}</span>
      </button>
      {status === "error" && message && <span className="max-w-[260px] truncate text-[10px] text-rose-400" title={message}>{message}</span>}
    </div>
  );
}
