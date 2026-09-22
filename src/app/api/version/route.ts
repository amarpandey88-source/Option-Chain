import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

// GET /api/version — the currently running app's version, read straight
// from package.json rather than duplicated as a hardcoded string in the
// frontend (which would silently go stale the moment package.json's
// version bumps for a release).
export async function GET() {
  try {
    const pkgPath = path.join(process.cwd(), "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return NextResponse.json({ version: pkg.version || "unknown" });
  } catch (err: any) {
    console.error("[api/version] failed to read package.json:", err);
    return NextResponse.json({ version: "unknown" });
  }
}
