import { NextResponse } from "next/server";

// db/trade-reference imported dynamically inside the try block, same
// convention as the other journal routes (a static import would turn any
// DB/client problem into a raw non-JSON crash page).

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { getReference } = await import("@/lib/trade-reference");
    const ref = await getReference(true);
    return NextResponse.json({
      ...ref,
      note: ref.active
        ? "Active: buckets with enough trades nudge confidence slightly (see minBucket). Time, VIX and Quality are used; regime and action are shown for reference only."
        : `Not active yet: needs ${ref.minTotal} closed broker-mode trades that carry entry context (have ${ref.total}). Until then nothing is adjusted.`,
    });
  } catch (err) {
    console.error("[api/trade-reference/stats] failed:", err);
    return NextResponse.json(
      { error: "TRADE_REFERENCE_FAILED", message: err instanceof Error ? err.message : "Failed to compute trade reference." },
      { status: 500 },
    );
  }
}
