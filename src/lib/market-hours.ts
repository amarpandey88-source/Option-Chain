// Works in both the browser (alert-manager.tsx) and the Node server
// (multi-symbol-watcher.ts) — new Date().toLocaleString with a timeZone
// works in both contexts, so this stays a single shared source of truth
// instead of two copies that could drift apart.

// 3:15 PM IST — the exact same cutoff the EOD square-off logic already
// uses to force-close open trades (see page.tsx's active-trade effect and
// multi-symbol-watcher.ts's checkOpenTrade). Deliberately the same number:
// there's no reason to open a brand-new trade at a time the app itself is
// about to force it closed again with essentially no room for the trade
// to actually play out.
const NEW_ENTRY_CUTOFF_MINUTES = 15 * 60 + 15;

export function istMinutesNow(): number {
  const istNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  return istNow.getHours() * 60 + istNow.getMinutes();
}

// True from 3:15 PM IST through the rest of the day (and pre-market,
// technically — a fresh signal shouldn't fire outside market hours either,
// though that's normally moot since the underlying data itself won't be
// live pre/post market).
export function isPastNewEntryCutoff(): boolean {
  return istMinutesNow() >= NEW_ENTRY_CUTOFF_MINUTES;
}
