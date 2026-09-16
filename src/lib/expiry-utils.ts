import type { Symbol } from "./types";

// ============================================================================
// Expiry calculation — single source of truth.
// ============================================================================
// Previously this exact logic was duplicated in both yahoo-adapter.ts and
// broker-adapter.ts ("kept in sync manually" per their own comments) — a
// real risk, since exactly this kind of drift is what caused Bank Nifty's
// expiry to be computed wrong (treated as weekly when NSE discontinued its
// weekly options in Nov 2024; it's monthly-only now). Consolidating into one
// file removes that risk, and being isomorphic (no server-only imports)
// means the UI can compute the same candidate expiry list a user picks from
// without a network round-trip.
//
// NSE (Nifty 50): weekly, Tuesday — since 1 Sept 2025 (SEBI standardisation;
//   was Thursday before that).
// NSE (Bank Nifty): NO weekly options since Nov 2024 (SEBI restricted each
//   exchange to one weekly-expiry benchmark index; NSE kept Nifty 50 for
//   that slot). Bank Nifty trades ONLY a monthly contract, last Tuesday of
//   the month.
// BSE (Sensex): weekly, Thursday — since 4 Sept 2025.
//
// Expiry days are occasionally revised by exchange/SEBI circular — verify
// here first if option-chain fetches ever start failing for a symbol again.
// ============================================================================

const WEEKLY_EXPIRY_WEEKDAY: Record<"NIFTY" | "SENSEX", number> = { NIFTY: 2, SENSEX: 4 }; // 0=Sun..6=Sat

function getLastWeekdayOfMonth(year: number, monthIndex: number, weekday: number): Date {
  const lastDayOfMonth = new Date(year, monthIndex + 1, 0); // day 0 of next month = last day of this month
  const diff = (lastDayOfMonth.getDay() - weekday + 7) % 7;
  lastDayOfMonth.setDate(lastDayOfMonth.getDate() - diff);
  return lastDayOfMonth;
}

function getNextWeeklyExpiry(targetWeekday: number, after: Date): Date {
  const daysUntil = (targetWeekday - after.getDay() + 7) % 7 || 7;
  const d = new Date(after);
  d.setDate(after.getDate() + daysUntil);
  return d;
}

function toISODate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function toLabel(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

/** The next real expiry for a symbol, right now (today). */
export function getDefaultExpiry(symbol: Symbol): { iso: string; label: string } {
  const today = new Date();
  if (symbol === "BANKNIFTY") {
    let expiry = getLastWeekdayOfMonth(today.getFullYear(), today.getMonth(), 2);
    if (expiry < today) expiry = getLastWeekdayOfMonth(today.getFullYear(), today.getMonth() + 1, 2);
    return { iso: toISODate(expiry), label: toLabel(expiry) };
  }
  const expiry = getNextWeeklyExpiry(WEEKLY_EXPIRY_WEEKDAY[symbol], today);
  return { iso: toISODate(expiry), label: toLabel(expiry) };
}

/**
 * Candidate expiries a user could pick from — real, computed dates only
 * (never fabricated/guessed). NIFTY/SENSEX: next several weekly expiries.
 * BANKNIFTY: next several monthly expiries (last Tuesday of each month).
 */
export function listCandidateExpiries(symbol: Symbol, count = 6): { iso: string; label: string }[] {
  const today = new Date();
  const out: { iso: string; label: string }[] = [];

  if (symbol === "BANKNIFTY") {
    let year = today.getFullYear();
    let month = today.getMonth();
    let first = getLastWeekdayOfMonth(year, month, 2);
    if (first < today) { month += 1; first = getLastWeekdayOfMonth(year, month, 2); }
    for (let i = 0; i < count; i++) {
      const m = month + i;
      const expiry = getLastWeekdayOfMonth(year, m, 2);
      out.push({ iso: toISODate(expiry), label: expiry.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) });
    }
    return out;
  }

  const targetWeekday = WEEKLY_EXPIRY_WEEKDAY[symbol as "NIFTY" | "SENSEX"];
  let cursor = today;
  for (let i = 0; i < count; i++) {
    const expiry = getNextWeeklyExpiry(targetWeekday, cursor);
    out.push({ iso: toISODate(expiry), label: toLabel(expiry) });
    cursor = expiry;
  }
  return out;
}

/** Days remaining (>= 1) until an ISO expiry date, from now. */
export function daysUntil(expiryIso: string): number {
  const today = new Date();
  const expiry = new Date(expiryIso + "T15:30:00"); // NSE/BSE close, so "expiry day itself" still counts as >=1 day until session close
  return Math.max(1, Math.round((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
}
