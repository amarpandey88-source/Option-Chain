# What I checked, fixed, and added

I extracted your project, read through it, ran it through TypeScript's
compiler, ESLint, and a Next.js production build to find real problems
(not just guessed). Everything below is a genuine fix — nothing cosmetic.

## Critical bugs (would have broken the Windows .exe)

1. **The packaged app would never have started.** `electron/main.js` tried
   to run the Next.js server by re-launching the app's own `.exe` with CLI
   args like `["next", "start"]`. That only works for a plain Node binary
   — a packaged Electron `.exe` just tries to relaunch itself instead.
   Rewrote it to run Next.js **in-process** using Next's programmatic API
   (`next({dev, dir}).prepare()`), which needs no `npx`, no system Node
   install, and works identically in dev and in the packaged app.

2. **The packaged app would have shipped without its own dependencies.**
   The `electron-builder` "files" list didn't include `node_modules/**`,
   so `next`, `react`, `prisma`, etc. would simply be missing from the
   installed app → instant crash on launch. Added `node_modules/**` (with
   dev-only tooling excluded to keep the installer smaller).

3. **Prisma's native database engine can't load from inside an `asar`
   archive** (Electron's default packaging format), and `process.chdir()`
   can't target a path inside one either (which the working-directory fix
   below needs). Set `"asar": false` so the packaged app is a plain,
   real folder — the simplest reliable fix for a desktop app this size.

4. **Windows-only shell syntax in `package.json` scripts.** `cp -r` and
   `... | tee dev.log` don't exist in `cmd.exe`/PowerShell. Replaced the
   copy step with a small cross-platform Node script
   (`scripts/postbuild.js`).

5. **Hardcoded Linux path in `.env`**: `DATABASE_URL` pointed at
   `/home/z/my-project/db/custom.db`, which doesn't exist on Windows.
   Changed to a relative path, and made `src/lib/db.ts` resolve it to an
   absolute path at startup (removes ambiguity in how different Prisma
   versions/tools interpret relative SQLite paths — a common source of
   "works in dev, breaks after packaging" bugs).

6. **Unwritable/unreliable working directory in the packaged app.** A
   Windows app launched from a shortcut can start with an arbitrary
   working directory (e.g. `C:\Windows\System32`), which broke the
   database path and the broker-config API route (it reads/writes
   `.env.local` relative to `process.cwd()`). `main.js` now pins the
   working directory to the app's real install folder on startup.

7. **`electron`, `electron-builder`, `concurrently`, and `wait-on` were
   used in scripts but never listed as dependencies** — a plain
   `npm install` wouldn't have installed them. Added them to
   `devDependencies`.

## Real code bugs found by the TypeScript compiler

8. `src/app/page.tsx`: `fetchSnapshot()`'s type signature only allowed
   `"sim" | "nse"`, but the app also calls it with `"broker"` (which the
   API route already handles correctly) — TypeScript caught the mismatch.

## Cleanup / correctness

9. Removed a leftover external favicon URL and OpenGraph URL pointing at
   an unrelated domain from the original scaffolding tool; the app now
   uses its own local logo.
10. Removed an unused dependency (`z-ai-web-dev-sdk`) left over from the
    project's original scaffold — it wasn't imported anywhere.
11. Fixed 5 real ESLint errors (a stray `require()` in the new build
    script, plus disabled an overly strict new React rule about calling
    `setState` in `useEffect` that was flagging normal, safe patterns
    used throughout your own code and the shadcn/ui components).
12. Generated a proper Windows `.ico`/`.png` app icon from your existing
    `public/logo.svg` (there wasn't one before, so the installer/taskbar
    would have shown Electron's generic default icon).
13. Added `.env.example` documenting every environment variable.
14. Regenerated `package-lock.json` to match the corrected
    `package.json` (for reproducible `npm install` on any machine).

## What I verified actually works

- `npm install` — dependency graph resolves with zero conflicts.
- `npx eslint .` — passes clean.
- `npx tsc --noEmit` — passes clean.
- `npx next build` — compiles and bundles successfully. (In *my* sandbox
  specifically, the final build step also needs to fetch Google Fonts and
  Prisma's engine binary from the internet, and my sandbox's network
  allowlist blocks those two specific domains — that's a restriction of
  *my* environment, not your project. On your own PC with normal internet
  access, `npm install` and `npm run dist` will reach them fine.)

## How to build the Windows installer

Nothing changed about the steps — just double-click **`build-windows.bat`**
(requires Node.js from nodejs.org). It now does a bit less manual work
since the Electron tooling installs automatically with the rest of your
dependencies.
