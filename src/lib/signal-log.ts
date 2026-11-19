import { db, ensureSchema } from "./db";
import { istMinutesNow } from "./market-hours";
import type { OptionChainSnapshot } from "./types";

// ============================================================================
// Signal log
// ----------------------------------------------------------------------------
// The Trade Journal only ever sees signals that actually became trades. This
// log records EVERY snapshot's signal state (including the ones the smart
// engine blocked or the watcher's filters skipped) together with what the
// market did afterwards, so signal quality can be measured honestly:
// "of the signals the engine confirmed, how often did price actually move
// the predicted way within 15/30/60 minutes — and was it better than the
// ones it blocked?".
//
// Outcomes are SPOT-based (index points / % move), not option-premium P&L —
// they measure directional accuracy of the signal, not trade profitability
// (theta, IV change and slippage are not included).
//
// Everything here is best-effort: logging must never throw into the trading
// or snapshot path.
// ============================================================================

const MARKET_OPEN_MIN = 9 * 60 + 15;
const MARKET_CLOSE_MIN = 15 * 60 + 30;
const RETENTION_DAYS = 90;
const HORIZONS_MIN = [15, 30, 60] as const;
// A later row counts as "the value at +N min" only if it lands within this
// many minutes after the horizon (gaps happen when the app was closed).
const MATCH_TOLERANCE_MIN = 5;
const RESOLVE_AFTER_MIN = 60 + MATCH_TOLERANCE_MIN;

const istDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD

export async function logSignal(
  snapshot: OptionChainSnapshot,
  dataSource: string,
  origin: "dashboard" | "watcher",
): Promise<void> {
  try {
    // Real broker data only: Yahoo mode has simulated OI, so logging it would
    // pollute the very measurements this exists to make trustworthy.
    if (!dataSource.startsWith("broker-")) return;

    const minute = istMinutesNow();
    if (minute < MARKET_OPEN_MIN || minute > MARKET_CLOSE_MIN) return;

    const m = snapshot.metrics;
    if (!Number.isFinite(m.spot) || m.spot <= 0) return;

    await ensureSchema();

    const now = new Date();
    const captured = new Date(now);
    captured.setUTCSeconds(0, 0);
    const capturedAt = captured.toISOString();
    const id = `${m.symbol}-${capturedAt}`; // one row per symbol per minute

    const base = snapshot.overallSignal;
    const candidateDir = base.signal === "BUY CE" ? 1 : base.signal === "BUY PE" ? -1 : 0;
    const s = snapshot.smartSignal;
    const factors = JSON.stringify(Object.fromEntries(s.factors.map(f => [f.key, f.score])));
    const blockers = JSON.stringify(s.blockers);

    await db.$executeRaw`
      INSERT OR IGNORE INTO "SignalLog" (
        "id", "symbol", "capturedAt", "istDay", "istMinute", "origin", "dataSource",
        "spot", "atmStrike", "atmIv", "vix", "pcr", "gex", "regime",
        "baseSignal", "baseConfidence", "candidateDir",
        "smartAction", "smartScore", "smartConfidence", "quality", "confirmed", "edge",
        "stabilityCount", "isLocked", "blockers", "factors"
      ) VALUES (
        ${id}, ${m.symbol}, ${capturedAt}, ${istDay(now)}, ${minute}, ${origin}, ${dataSource},
        ${m.spot}, ${m.atmStrike}, ${snapshot.greeks.iv}, ${m.indiaVix}, ${m.pcr}, ${m.gex}, ${m.regime},
        ${base.signal}, ${base.confidence}, ${candidateDir},
        ${s.action}, ${s.score}, ${s.confidence}, ${s.quality}, ${s.confirmed ? 1 : 0}, ${s.edge},
        ${snapshot.signalStability.consecutiveCount}, ${snapshot.signalStability.isLocked ? 1 : 0}, ${blockers}, ${factors}
      )
    `;
  } catch (err) {
    console.error("[signal-log] logSignal failed:", err);
  }
}

interface PendingRow { id: string; symbol: string; capturedAt: string; istDay: string; spot: number }
interface LaterRow { capturedAt: string; spot: number }

// Fills in the +15/+30/+60 min spot values and the max up/down excursion for
// rows old enough to have them, using the later rows already in the log (so
// no extra broker calls). Safe to call often; only touches unresolved rows.
export async function resolveSignalOutcomes(): Promise<number> {
  try {
    await ensureSchema();
    const cutoff = new Date(Date.now() - RESOLVE_AFTER_MIN * 60_000).toISOString();
    const pending = await db.$queryRaw<PendingRow[]>`
      SELECT "id", "symbol", "capturedAt", "istDay", "spot"
      FROM "SignalLog"
      WHERE "resolvedAt" IS NULL AND "capturedAt" <= ${cutoff}
      ORDER BY "capturedAt" ASC
      LIMIT 500
    `;

    for (const row of pending) {
      const t0 = new Date(row.capturedAt).getTime();
      const windowEnd = new Date(t0 + (60 + MATCH_TOLERANCE_MIN) * 60_000).toISOString();
      // Same IST trading day only — never pair a 3 PM row with next morning's.
      const later = await db.$queryRaw<LaterRow[]>`
        SELECT "capturedAt", "spot"
        FROM "SignalLog"
        WHERE "symbol" = ${row.symbol} AND "istDay" = ${row.istDay}
          AND "capturedAt" > ${row.capturedAt} AND "capturedAt" <= ${windowEnd}
        ORDER BY "capturedAt" ASC
      `;

      const spotAt = (horizonMin: number): number | null => {
        const lo = t0 + horizonMin * 60_000;
        const hi = lo + MATCH_TOLERANCE_MIN * 60_000;
        const hit = later.find(l => {
          const t = new Date(l.capturedAt).getTime();
          return t >= lo && t <= hi;
        });
        return hit ? hit.spot : null;
      };

      // Excursion over the first 60 minutes only.
      const hourEnd = t0 + 60 * 60_000;
      let maxUp: number | null = null;
      let maxDown: number | null = null;
      for (const l of later) {
        if (new Date(l.capturedAt).getTime() > hourEnd) break;
        const d = l.spot - row.spot;
        maxUp = maxUp === null ? d : Math.max(maxUp, d);
        maxDown = maxDown === null ? d : Math.min(maxDown, d);
      }

      const [s15, s30, s60] = HORIZONS_MIN.map(spotAt);
      await db.$executeRaw`
        UPDATE "SignalLog"
        SET "spot15" = ${s15}, "spot30" = ${s30}, "spot60" = ${s60},
            "maxUp60" = ${maxUp}, "maxDown60" = ${maxDown},
            "resolvedAt" = ${new Date().toISOString()}
        WHERE "id" = ${row.id}
      `;
    }

    const retentionCutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60_000).toISOString();
    await db.$executeRaw`DELETE FROM "SignalLog" WHERE "capturedAt" < ${retentionCutoff}`;

    return pending.length;
  } catch (err) {
    console.error("[signal-log] resolveSignalOutcomes failed:", err);
    return 0;
  }
}

// ----------------------------------------------------------------------------
// Stats
// ----------------------------------------------------------------------------
// Buckets with fewer rows than this are flagged lowSample — a hit rate off a
// handful of signals is noise (note this is stricter than the Trade Journal's
// MIN_SAMPLE_SIZE of 8, which is too small to trust for calibration).
export const SIGNAL_LOG_MIN_SAMPLE = 30;

interface StatRow {
  symbol: string; istMinute: number; regime: string; baseSignal: string; baseConfidence: number;
  candidateDir: number; smartAction: string; quality: string; confirmed: number; blockers: string;
  spot: number; spot15: number | null; spot30: number | null; spot60: number | null;
}

export interface StatBucket {
  label: string;
  n: number;
  hitRate: number; // % of signals where price moved in the signal's direction at the horizon
  avgMovePct: number; // average direction-adjusted spot move in %, +ve = in signal's favour
  lowSample: boolean;
}

function toBucket(label: string, moves: number[]): StatBucket {
  const n = moves.length;
  const hits = moves.filter(v => v > 0).length;
  const avg = n ? moves.reduce((a, b) => a + b, 0) / n : 0;
  return {
    label, n,
    hitRate: n ? Number(((hits / n) * 100).toFixed(1)) : 0,
    avgMovePct: Number(avg.toFixed(3)),
    lowSample: n < SIGNAL_LOG_MIN_SAMPLE,
  };
}

export async function getSignalStats(opts: { days: number; horizon: 15 | 30 | 60; symbol?: string }) {
  await ensureSchema();
  const since = new Date(Date.now() - opts.days * 24 * 60 * 60_000).toISOString();
  const rows = opts.symbol
    ? await db.$queryRaw<StatRow[]>`
        SELECT "symbol","istMinute","regime","baseSignal","baseConfidence","candidateDir","smartAction","quality","confirmed","blockers","spot","spot15","spot30","spot60"
        FROM "SignalLog" WHERE "capturedAt" >= ${since} AND "symbol" = ${opts.symbol}`
    : await db.$queryRaw<StatRow[]>`
        SELECT "symbol","istMinute","regime","baseSignal","baseConfidence","candidateDir","smartAction","quality","confirmed","blockers","spot","spot15","spot30","spot60"
        FROM "SignalLog" WHERE "capturedAt" >= ${since}`;

  const groups: Record<string, Record<string, number[]>> = {
    bySmartVerdict: {}, byQuality: {}, byRegime: {}, byHour: {}, byBaseConfidence: {}, byBlocker: {},
  };
  const push = (group: string, label: string, v: number) => { (groups[group][label] ||= []).push(v); };

  let withOutcome = 0;
  for (const r of rows) {
    // Direction under test: the smart engine's own call when it confirmed one,
    // otherwise the base engine's candidate direction (what WOULD have fired).
    const dir = r.smartAction === "BUY CE" ? 1 : r.smartAction === "BUY PE" ? -1 : r.candidateDir;
    if (dir === 0) continue;
    const later = opts.horizon === 15 ? r.spot15 : opts.horizon === 30 ? r.spot30 : r.spot60;
    if (later === null) continue;
    withOutcome++;
    const move = (dir * (later - r.spot) / r.spot) * 100;

    push("bySmartVerdict", r.confirmed ? "smart-confirmed" : "base-signal blocked by smart engine", move);
    if (r.confirmed) push("byQuality", `quality ${r.quality}`, move);
    push("byRegime", r.regime, move);
    const h = Math.floor(r.istMinute / 60);
    push("byHour", `${h}:00-${h}:59 IST`, move);
    const band = Math.floor(r.baseConfidence / 10) * 10;
    push("byBaseConfidence", `${band}-${band + 9}%`, move);
    if (!r.confirmed) {
      let list: string[] = [];
      try { list = JSON.parse(r.blockers); } catch { /* ignore malformed */ }
      for (const b of list) push("byBlocker", b, move);
    }
  }

  const out: Record<string, StatBucket[]> = {};
  for (const [g, buckets] of Object.entries(groups)) {
    out[g] = Object.entries(buckets).map(([label, moves]) => toBucket(label, moves)).sort((a, b) => b.n - a.n);
  }

  return {
    horizonMin: opts.horizon,
    days: opts.days,
    totalLogged: rows.length,
    withOutcome,
    minSample: SIGNAL_LOG_MIN_SAMPLE,
    note: "Spot-based directional accuracy, not option P&L. Ignore buckets flagged lowSample.",
    ...out,
  };
}
