// ============================================================================
// Deletes .next before every production build.
//
// `npm run electron:dev` runs `next dev`, which uses Turbopack by default
// and writes its own dev-mode chunk layout into .next (including files like
// chunks/[turbopack_runtime].js). If a production `next build` then runs
// without .next being cleared first, build can end up reusing/merging with
// those leftover dev-mode Turbopack artifacts instead of producing a clean
// webpack output — which is what caused the packaged app to try requiring
// a Turbopack-internal hashed module name ("@prisma/client-<hash>") that
// never actually existed as a real file, crashing every Prisma call.
//
// Written in plain Node (not `rm -rf`) so it works identically on Windows,
// where the default cmd.exe/PowerShell has no `rm` command.
// ============================================================================

const fs = require("fs");
const path = require("path");

const nextDir = path.join(__dirname, "..", ".next");

if (fs.existsSync(nextDir)) {
  fs.rmSync(nextDir, { recursive: true, force: true });
  console.log("[clean-next] removed stale .next directory");
} else {
  console.log("[clean-next] no .next directory to remove");
}
