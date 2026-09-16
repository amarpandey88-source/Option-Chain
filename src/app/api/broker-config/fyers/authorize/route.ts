import { NextRequest, NextResponse } from "next/server";
import { beginFyersAuth, FYERS_REDIRECT_URI } from "@/lib/fyers-oauth";

export const dynamic = "force-dynamic";

// POST /api/broker-config/fyers/authorize — step 1 of the in-app Fyers
// login flow. Takes the App ID + Secret ID from the user's Fyers dashboard
// app and returns the login URL to open in an in-app popup/child window,
// plus a one-time state token used to complete the flow once Fyers
// redirects back to FYERS_REDIRECT_URI.
export async function POST(req: NextRequest) {
  try {
    const { appId, secretId } = await req.json();
    if (!appId || !secretId) {
      return NextResponse.json(
        { error: "App ID and Secret ID are both required to start Fyers login." },
        { status: 400 }
      );
    }
    const { authUrl, state } = beginFyersAuth(String(appId).trim(), String(secretId).trim());
    return NextResponse.json({ authUrl, state, redirectUri: FYERS_REDIRECT_URI });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to start Fyers login" }, { status: 500 });
  }
}
