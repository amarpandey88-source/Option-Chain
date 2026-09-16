import { createHash, randomBytes } from "node:crypto";

// ============================================================================
// Fyers API v3 — in-app OAuth login flow
// ----------------------------------------------------------------------------
// Goal: the user should never have to leave the app / open a system browser
// and copy-paste a daily access token by hand. Everything below happens
// inside the app's own window (see electron/main.js's setWindowOpenHandler,
// which opens the Fyers login page as an in-app child window instead of
// handing it off to the system browser like every other external link).
//
// Flow (confirmed from Fyers' own docsv3 + the official fyers-apiv3 SDK
// source — e.g. https://github.com/tkanhe/fyers-api-access-token-v3 and
// multiple real user-posted validate-authcode payloads on Fyers' own
// community forum):
//   1. Build a "generate-authcode" URL with the app's client_id (App ID)
//      and a redirect_uri. That redirect_uri MUST exactly match the
//      "Redirect URL" the user entered when creating their app on
//      myapi.fyers.in/dashboard — that's a one-time setup step done once
//      per app (unavoidable, same as any OAuth app registration), not a
//      daily hassle.
//   2. User logs in on that page, inside our own popup/child window.
//   3. Fyers redirects the popup back to our redirect_uri with
//      ?auth_code=...&state=...&s=ok.
//   4. Exchange auth_code -> access_token via POST validate-authcode,
//      authenticated with appIdHash = sha256(`${appId}:${secretId}`) —
//      confirmed field name and hashing scheme from several independent
//      real Fyers integrations.
//
// The access token itself is still only valid for the trading day (that's
// Fyers' own expiry policy, not something any client can change) — this
// flow just turns "getting a fresh one" into a two-click in-app action
// instead of a manual daily browser-and-copy-paste chore.
// ============================================================================

export const FYERS_REDIRECT_PATH = "/api/broker-config/fyers/callback";
// Fixed to 127.0.0.1:3000 because that's the port electron/main.js's
// in-process Next.js server always listens on (NEXT_PORT), in both
// `npm run electron:dev` and the packaged Windows app. This exact URL is
// what the user pastes as their app's "Redirect URL" once when creating
// it on the Fyers dashboard.
export const FYERS_REDIRECT_URI = `http://127.0.0.1:3000${FYERS_REDIRECT_PATH}`;

interface PendingAuth {
  appId: string;
  secretId: string;
  createdAt: number;
}

// In-memory only — this only needs to bridge the ~1-2 minutes between
// opening the login popup and Fyers redirecting back, within a single
// running app process. Nothing here needs to survive a restart, and
// nothing here is written to disk (the secret briefly lives in RAM only,
// same as it would while a request using it is in flight).
const pending = new Map<string, PendingAuth>();
const PENDING_TTL_MS = 10 * 60 * 1000; // 10 min — generous for a slow login

function cleanupExpired() {
  const now = Date.now();
  for (const [state, p] of pending) {
    if (now - p.createdAt > PENDING_TTL_MS) pending.delete(state);
  }
}

// Step 1: called when the user clicks "Connect via Fyers Login". Returns
// the URL to open in the in-app login window, plus a one-time state token
// used to complete the flow once Fyers redirects back to us.
export function beginFyersAuth(appId: string, secretId: string): { authUrl: string; state: string } {
  cleanupExpired();
  const state = randomBytes(16).toString("hex");
  pending.set(state, { appId, secretId, createdAt: Date.now() });
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: FYERS_REDIRECT_URI,
    response_type: "code",
    state,
  });
  return { authUrl: `https://api-t1.fyers.in/api/v3/generate-authcode?${params.toString()}`, state };
}

// Step 2: called by the callback route once Fyers redirects back with a
// real auth_code. Looks up the appId/secretId stashed in step 1 (so the
// secret never has to round-trip through Fyers' redirect URL), exchanges
// the code for a real access token, and returns everything needed to save
// the broker config.
export async function completeFyersAuth(state: string, authCode: string): Promise<{ appId: string; secretId: string; accessToken: string }> {
  const p = pending.get(state);
  pending.delete(state); // one-time use either way — success or failure
  if (!p) {
    throw new Error('This login link has expired or was already used. Go back to the app and click "Connect via Fyers Login" again.');
  }
  const appIdHash = createHash("sha256").update(`${p.appId}:${p.secretId}`).digest("hex");
  const res = await fetch("https://api-t1.fyers.in/api/v3/validate-authcode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code", appIdHash, code: authCode }),
  });
  const data = await res.json().catch(() => ({}) as any);
  if (!res.ok || !data.access_token) {
    throw new Error(`Fyers token exchange failed: ${data.message || `HTTP ${res.status}`}. Double-check your App ID and Secret ID are correct.`);
  }
  return { appId: p.appId, secretId: p.secretId, accessToken: data.access_token as string };
}
