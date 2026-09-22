"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2 } from "lucide-react";

interface ChangelogEntry {
  version: string;
  date: string | null;
  changes: string[];
}

// Shown as the first section of the in-app Help/Manual (help-dialog.tsx),
// so "what's new" is always visible in the same place, every time someone
// opens Help — not just as a one-off popup after an update. Sourced from
// the same CHANGELOG.md the update-downloaded dialog in electron/main.js
// reads its release notes from (via /api/changelog), so both places
// always agree.
export function WhatsNewSection() {
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    fetch("/api/changelog", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { setEntries(d.entries || []); setAvailable(!!d.available); })
      .catch(() => { setEntries([]); setAvailable(false); });
    fetch("/api/version", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setVersion(d.version))
      .catch(() => setVersion(null));
  }, []);

  return (
    <>
      <div className="flex items-center gap-2 mb-1">
        {version && (
          <Badge variant="outline" className="text-[10px] font-mono bg-amber-500/10 text-amber-400 border-amber-700/40">
            Currently running v{version}
          </Badge>
        )}
      </div>

      {entries === null && (
        <div className="flex items-center gap-2 text-[12.5px] text-slate-500 py-3">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading changelog…
        </div>
      )}

      {entries !== null && !available && (
        <p className="text-[12.5px] text-slate-500 leading-relaxed">
          No CHANGELOG.md found alongside this build, so there's nothing to show here yet.
        </p>
      )}

      {entries !== null && available && entries.length === 0 && (
        <p className="text-[12.5px] text-slate-500 leading-relaxed">
          Nothing recorded in CHANGELOG.md yet.
        </p>
      )}

      {entries !== null && entries.length > 0 && (
        <div className="space-y-4">
          {entries.map((e) => (
            <div key={e.version} className="rounded-md border border-[#1c2530] bg-[#0a0e14] px-3 py-2.5">
              <div className="flex items-center gap-2 mb-1.5">
                <Sparkles className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <span className="text-[13px] font-semibold text-slate-100">
                  {e.version === "Unreleased" ? "Unreleased (in progress)" : `v${e.version}`}
                </span>
                {e.date && <span className="text-[11px] text-slate-500 font-mono">{e.date}</span>}
              </div>
              <ul className="space-y-1 ml-1">
                {e.changes.map((c, i) => (
                  <li key={i} className="text-[12.5px] text-slate-300 leading-relaxed flex gap-2">
                    <span className="text-amber-500 mt-1.5 h-1 w-1 rounded-full bg-amber-500 shrink-0" />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
