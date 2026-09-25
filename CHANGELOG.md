# Changelog

All notable changes to **Option Chain Pulse** are documented here, newest
version first.

This file is the single source of truth for two things:
1. The in-app **Help → What's New** section (read via `/api/changelog`).
2. The Windows auto-updater's "Update ready" dialog, which shows
   `info.releaseNotes` — the description text you paste when publishing a
   GitHub Release.

**Workflow when you cut a release:** write what changed under `## [Unreleased]`
as you go. When you're ready to publish a version, rename that heading to
`## [x.y.z] - YYYY-MM-DD` (today's date), start a fresh empty `## [Unreleased]`
above it, then copy the same bullet list into the GitHub Release's
description box when you publish the tag. That keeps the in-app changelog,
the GitHub Release page, and the update-downloaded dialog all saying the
exact same thing.

Format per entry: `## [version] - YYYY-MM-DD` followed by a bullet list.

## [Unreleased]

## [1.0.5] - 2026-09-25
- Refreshed Help & What's New with release summaries, searchable updates, clearer status signals, and responsive presentation

## [1.0.4] - 2026-09-25
- Fixed the Check for Updates button overlapping the header controls by moving it into the responsive toolbar

## [1.0.3] - 2026-09-25
- Added a dedicated Smart Signal tab for focused signal analysis
- Added automatic update checking and background download support for Windows
- Documented the Smart Signal and update changes in Help -> What's New

## [1.0.1] - YYYY-MM-DD
<!-- fill in the real release date above -->
- Added automatic update checking and background download via GitHub
  Releases (electron-updater), with a restart prompt once a new version is
  ready
- Windows packaging fixes: Next.js now runs in-process inside Electron
  instead of re-spawning the app's own .exe, Prisma's native engine is
  bundled correctly for a Windows build made on any OS, and build scripts
  were made cross-platform (no more `cp`/`tee` shell-only syntax)
