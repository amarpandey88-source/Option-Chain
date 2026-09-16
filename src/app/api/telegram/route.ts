import { NextRequest, NextResponse } from "next/server";
import { getTelegramConfig, saveTelegramConfig, deleteTelegramConfig, TelegramConfig } from "@/lib/telegram-config";

export const dynamic = "force-dynamic";

// ============================================================================
// Telegram alert delivery
// ----------------------------------------------------------------------------
// Uses Telegram's own public Bot API (https://core.telegram.org/bots/api,
// specifically the well-documented `sendMessage` method) — this is a
// stable, officially documented endpoint, unlike some of the broker
// endpoints elsewhere in this app that needed defensive fallbacks.
//
// Bot token + chat ID are stored the same way broker credentials are (a
// small JSON file in the writable config directory, alongside .env.local)
// so they survive app restarts without living in the main .env.local file.
// Storage itself lives in src/lib/telegram-config.ts, not here — Next.js
// route.ts files may only export the standard HTTP method handlers
// (GET/POST/etc.), not arbitrary helper functions.
// ============================================================================

// GET — is Telegram configured right now?
export async function GET() {
  const cfg = getTelegramConfig();
  return NextResponse.json({ configured: !!cfg });
}

// POST — two jobs depending on body shape:
//  { botToken, chatId } -> save config + send a test message to confirm it works
//  { message }          -> send an actual alert using the already-saved config
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.botToken && body.chatId) {
      const cfg: TelegramConfig = { botToken: String(body.botToken).trim(), chatId: String(body.chatId).trim() };
      const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: cfg.chatId, text: "✅ Option Chain Pulse is now connected. You'll get trade alerts here even when the app window is closed." }),
      });
      const data = await res.json().catch(() => ({}) as any);
      if (!res.ok || !data.ok) {
        return NextResponse.json({ error: data.description || `Telegram rejected the request (HTTP ${res.status}). Double-check the Bot Token and Chat ID.` }, { status: 400 });
      }
      saveTelegramConfig(cfg);
      return NextResponse.json({ saved: true });
    }

    if (body.message) {
      const cfg = getTelegramConfig();
      if (!cfg) return NextResponse.json({ error: "Telegram not configured" }, { status: 400 });
      const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: cfg.chatId, text: body.message, parse_mode: "HTML" }),
      });
      const data = await res.json().catch(() => ({}) as any);
      if (!res.ok || !data.ok) {
        console.error("[telegram] send failed:", data);
        return NextResponse.json({ error: data.description || "Send failed" }, { status: 502 });
      }
      return NextResponse.json({ sent: true });
    }

    return NextResponse.json({ error: "Provide either {botToken, chatId} to configure, or {message} to send" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Telegram request failed" }, { status: 500 });
  }
}

export async function DELETE() {
  deleteTelegramConfig();
  return NextResponse.json({ deleted: true });
}
