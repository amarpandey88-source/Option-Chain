// ============================================================================
// Post-build step — copies static assets into the Next.js "standalone"
// output. Written in plain Node so it runs identically on Windows, macOS
// and Linux (the previous version used `cp -r`, which does not exist on
// Windows' default cmd.exe / PowerShell).
// ============================================================================

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) {
    console.log(`[postbuild] skip (not found): ${path.relative(root, src)}`);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log(`[postbuild] copied ${path.relative(root, src)} -> ${path.relative(root, dest)}`);
}

const standaloneDir = path.join(root, ".next", "standalone");

if (!fs.existsSync(standaloneDir)) {
  console.log("[postbuild] .next/standalone not found — skipping (output: \"standalone\" build not produced).");
  process.exit(0);
}

copyIfExists(path.join(root, ".next", "static"), path.join(standaloneDir, ".next", "static"));
copyIfExists(path.join(root, "public"), path.join(standaloneDir, "public"));

// Note: this project's electron/main.js runs Next.js in-process via the
// `next()` programmatic API against the project root (not against
// .next/standalone/server.js), so .next/standalone/node_modules is never
// actually read at runtime — only the project's real node_modules is. The
// fix for Prisma's generated client going missing from the packaged app
// lives in package.json's electron-builder "files" glob instead (it needs
// an explicit "node_modules/.prisma/**/*" entry, since "node_modules/**"
// alone doesn't match dot-prefixed folders like .prisma).

console.log("[postbuild] done.");
