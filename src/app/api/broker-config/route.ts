import { NextRequest, NextResponse } from "next/server";
import { isBrokerConfigured, getConfiguredBroker } from "@/lib/broker-adapter";
import { configDir, writeBrokerConfig, BrokerProvider } from "@/lib/broker-config-store";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

// ============================================================================
// GET /api/broker-config — check if broker is configured + which broker
// ============================================================================
export async function GET() {
  return NextResponse.json({
    configured: isBrokerConfigured(),
    provider: getConfiguredBroker(),
    envFileExists: fs.existsSync(path.join(configDir(), ".env.local")),
  });
}

// ============================================================================
// POST /api/broker-config — save API keys to .env.local file
// ============================================================================
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { provider, credentials } = body;

    const validProviders = ["icici", "angel", "dhan", "fyers", "zerodha", "groww"];
    if (!validProviders.includes(provider)) {
      return NextResponse.json(
        { error: `Invalid provider. Must be one of: ${validProviders.join(", ")}` },
        { status: 400 }
      );
    }

    // Writes .env.local AND applies it to the running process immediately —
    // shared with the Fyers in-app OAuth callback so both paths save
    // credentials identically.
    writeBrokerConfig(provider as BrokerProvider, credentials);

    return NextResponse.json({
      success: true,
      provider,
      message: `Saved. ${getConfiguredBroker()} is now connected.`,
    });
  } catch (err: any) {
    console.error("[broker-config POST] error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to save config" },
      { status: 500 }
    );
  }
}

// ============================================================================
// DELETE /api/broker-config — remove .env.local (disconnect broker)
// ============================================================================
export async function DELETE() {
  try {
    const envPath = path.join(configDir(), ".env.local");
    if (fs.existsSync(envPath)) {
      fs.unlinkSync(envPath);
    }
    delete process.env.BROKER_PROVIDER;
    return NextResponse.json({ success: true, message: "Broker config removed." });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
