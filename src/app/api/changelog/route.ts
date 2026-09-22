import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

// ============================================================================
// GET /api/changelog — parses the repo's own CHANGELOG.md into structured
// entries so the in-app Help → What's New section (help-dialog.tsx) and the
// Windows update-downloaded dialog (electron/main.js) can both show the
// exact same release notes as the file on disk, instead of a second
// hand-maintained copy that could drift out of sync.
//
// Expected format (see CHANGELOG.md itself):
//   ## [1.2.0] - 2026-03-01
//   - bullet
//   - bullet
//   ## [Unreleased]
//   - bullet
//
// Deliberately tolerant: a missing/malformed CHANGELOG.md returns an empty
// list rather than a 500 — a broken changelog file should never take down
// the Help dialog it's shown in.
// ============================================================================

export interface ChangelogEntry {
  version: string;
  date: string | null; // null for "Unreleased" or a heading with no date
  changes: string[];
}

function findChangelogPath(): string | null {
  // process.cwd() is pinned to the app's real install directory by
  // electron/main.js (see its chdir call) — same assumption the rest of
  // the app already makes for DATABASE_URL/.env.local resolution.
  const candidate = path.join(process.cwd(), "CHANGELOG.md");
  return fs.existsSync(candidate) ? candidate : null;
}

function parseChangelog(raw: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  // Split on lines starting with "## [" — each match starts a new entry.
  const headingRe = /^##\s*\[([^\]]+)\]\s*(?:-\s*(.+))?$/gm;
  const matches = [...raw.matchAll(headingRe)];

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const version = m[1].trim();
    const dateRaw = m[2]?.trim();
    const date = dateRaw && !dateRaw.toLowerCase().includes("yyyy") ? dateRaw : null;
    const bodyStart = (m.index ?? 0) + m[0].length;
    const bodyEnd = i + 1 < matches.length ? matches[i + 1].index! : raw.length;
    const body = raw.slice(bodyStart, bodyEnd);

    const changes = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim())
      // Drop pure HTML-comment placeholder lines like "<!-- fill in ... -->"
      .filter((line) => !line.startsWith("<!--"));

    if (changes.length > 0) entries.push({ version, date, changes });
  }

  return entries;
}

export async function GET() {
  try {
    const filePath = findChangelogPath();
    if (!filePath) {
      return NextResponse.json({ entries: [], available: false });
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const entries = parseChangelog(raw);
    return NextResponse.json({ entries, available: true });
  } catch (err: any) {
    console.error("[api/changelog] failed to read/parse CHANGELOG.md:", err);
    return NextResponse.json({ entries: [], available: false });
  }
}
