import { PrismaClient } from '@prisma/client'
import path from 'path'
import fs from 'fs'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// ----------------------------------------------------------------------------
// Resolve a relative "file:./db/custom.db" DATABASE_URL to an absolute path
// before Prisma ever sees it. Relative sqlite paths are resolved differently
// by different Prisma tools/versions (sometimes relative to schema.prisma,
// sometimes relative to process.cwd()), which is a common source of "works
// on my machine but not after packaging" bugs — especially on Windows,
// where the app's working directory can vary (e.g. when launched from a
// desktop shortcut). Resolving to an absolute path here removes that
// ambiguity entirely, for local dev, `next start`, and the packaged
// Electron app alike.
// ----------------------------------------------------------------------------
function resolveDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL || 'file:./db/custom.db'
  const match = raw.match(/^file:(.+)$/)
  if (!match) return raw // not a sqlite "file:" URL — leave untouched

  const filePath = match[1]
  if (path.isAbsolute(filePath)) return raw // already absolute

  const absolutePath = path.resolve(/* turbopackIgnore: true */ process.cwd(), filePath)

  // Make sure the containing folder exists (e.g. first run of the packaged app).
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })

  // Prisma's sqlite/libsql URL parser wants forward slashes even on Windows.
  const normalized = absolutePath.split(path.sep).join('/')
  return `file:${normalized}`
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
    datasources: { db: { url: resolveDatabaseUrl() } },
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

// ----------------------------------------------------------------------------
// Self-healing schema bootstrap.
//
// This app ships a pre-built db/custom.db so the packaged Electron app (which
// deliberately excludes the `prisma` CLI to keep the installer small — see
// electron-builder config) never needs to run migrations on the user's
// machine. That's fine as long as that file is always present intact — but
// if it's ever missing (fresh install where packaging dropped it, a user/
// antivirus deletes it, a future re-package forgets to include it, etc.),
// every db call throws an unhandled "no such table" error that Next.js turns
// into a raw non-JSON "Internal Server Error" response — which is exactly
// what breaks the Trade Journal ("HTTP 500" / "Unexpected token 'I' ... is
// not valid JSON") instead of failing loudly and recoverably.
//
// So: idempotently CREATE TABLE IF NOT EXISTS for every model on first use,
// via raw SQL (no CLI needed, @prisma/client can always run raw queries).
// Cheap, runs once per process, and means a missing/fresh db file just
// quietly recreates itself instead of taking the whole journal down.
// ----------------------------------------------------------------------------
let schemaReady: Promise<void> | null = null

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "User" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "email" TEXT NOT NULL,
        "name" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL
      )`)
      await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email")`)

      await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Post" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "title" TEXT NOT NULL,
        "content" TEXT,
        "published" BOOLEAN NOT NULL DEFAULT false,
        "authorId" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL
      )`)

      await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "TradeJournal" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "alertId" TEXT NOT NULL,
        "symbol" TEXT NOT NULL,
        "action" TEXT NOT NULL,
        "optionType" TEXT NOT NULL,
        "strike" INTEGER NOT NULL,
        "entryPremium" REAL NOT NULL,
        "stopLoss" REAL NOT NULL,
        "target1" REAL NOT NULL,
        "target2" REAL NOT NULL,
        "target3" REAL NOT NULL,
        "entrySpot" REAL NOT NULL,
        "confidence" INTEGER NOT NULL,
        "sentiment" TEXT NOT NULL,
        "dataSource" TEXT NOT NULL,
        "regime" TEXT,
        "status" TEXT NOT NULL DEFAULT 'OPEN',
        "exitSpot" REAL,
        "exitPremium" REAL,
        "pnlPerLot" REAL,
        "totalPnl" REAL,
        "pnlPercent" REAL,
        "durationSec" INTEGER,
        "rationale" TEXT NOT NULL,
        "exitReason" TEXT,
        "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "closedAt" DATETIME
      )`)
      await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "TradeJournal_alertId_key" ON "TradeJournal"("alertId")`)
      await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "TradeJournal_symbol_idx" ON "TradeJournal"("symbol")`)
      await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "TradeJournal_status_idx" ON "TradeJournal"("status")`)
      await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "TradeJournal_openedAt_idx" ON "TradeJournal"("openedAt")`)
      // Additive migration for databases created before "regime" existed —
      // CREATE TABLE IF NOT EXISTS above only helps brand-new databases; an
      // already-existing TradeJournal table needs the column added
      // explicitly. SQLite has no "ADD COLUMN IF NOT EXISTS", so this just
      // tries the ALTER and swallows the "duplicate column" error on a
      // database that already has it (from a fresh CREATE TABLE, or from
      // this same ALTER already having run once before).
      try {
        await db.$executeRawUnsafe(`ALTER TABLE "TradeJournal" ADD COLUMN "regime" TEXT`)
      } catch {
        // Column already exists — expected and fine on every run after the first.
      }
    })().catch((err) => {
      // Don't cache a rejected promise forever — let the next call retry.
      schemaReady = null
      throw err
    })
  }
  return schemaReady
}