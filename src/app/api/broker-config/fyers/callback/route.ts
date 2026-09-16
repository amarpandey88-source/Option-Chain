import { NextRequest, NextResponse } from "next/server";
import { completeFyersAuth } from "@/lib/fyers-oauth";
import { writeBrokerConfig } from "@/lib/broker-config-store";

export const dynamic = "force-dynamic";

// GET /api/broker-config/fyers/callback — Fyers redirects the in-app login
// window here with ?auth_code=...&state=...&s=ok once the user logs in.
// This is the exact URL the user pastes as their app's "Redirect URL" on
// the Fyers dashboard (see FYERS_REDIRECT_URI) — it must match exactly.
//
// Renders a small standalone HTML page (not JSON) since this is loaded
// directly by the login window's browser navigation, not fetched by our
// own frontend code. The main app window discovers success by polling
// GET /api/broker-config in the background (see api-keys-dialog.tsx) —
// simpler and more robust across Electron/plain-browser than wiring up
// window.postMessage or IPC just for this.
function htmlPage(title: string, message: string, ok: boolean) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{background:#0a0e14;color:#e2e8f0;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;
    display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:24px}
  .box{max-width:380px}
  h1{font-size:16px;margin:0 0 10px;color:${ok ? "#34d399" : "#fb7185"}}
  p{font-size:13px;color:#94a3b8;line-height:1.5;margin:4px 0}
</style></head>
<body><div class="box"><h1>${title}</h1><p>${message}</p><p>You can close this window now.</p></div>
<script>setTimeout(function () { try { window.close(); } catch (e) {} }, 1200);</script>
</body></html>`;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const authCode = url.searchParams.get("auth_code");
  const state = url.searchParams.get("state");
  const s = url.searchParams.get("s");

  if (s !== "ok" || !authCode || !state) {
    const reason = url.searchParams.get("message") || "Login was cancelled, denied, or the link was incomplete.";
    return new NextResponse(htmlPage("Fyers login failed", reason, false), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  try {
    const { appId, secretId, accessToken } = await completeFyersAuth(state, authCode);
    writeBrokerConfig("fyers", { appId, secretId, accessToken });
    return new NextResponse(
      htmlPage("Connected to Fyers", "Your access token was saved. Switch to Broker mode in the app to use it.", true),
      { headers: { "Content-Type": "text/html" } }
    );
  } catch (err: any) {
    return new NextResponse(htmlPage("Fyers login failed", err.message || "Unknown error", false), {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
  }
}
