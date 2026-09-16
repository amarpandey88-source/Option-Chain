import { NextRequest } from "next/server";
import { subscribeFyersTick } from "@/lib/fyers-tick-stream";
import { getBrokerConfig } from "@/lib/broker-adapter";

export const dynamic = "force-dynamic";

// GET /api/live-tick?symbol=<real Fyers trading symbol> — Server-Sent
// Events stream of live LTP ticks for exactly one symbol. Meant to be open
// only while a trade in that symbol is active (see active-trade-panel.tsx),
// and closed by the browser (EventSource.close()) the moment the trade
// exits — see fyers-tick-stream.ts for why this is scoped to one symbol
// rather than the whole option chain.
//
// SSE (not a second WebSocket) on purpose: it's a plain HTTP GET the
// browser's native EventSource handles natively (auto-reconnect included),
// needs no extra ws server wired into Next.js, and this is one-way
// (server -> browser) data anyway, which is exactly what SSE is for.
export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) {
    return new Response("Missing ?symbol=", { status: 400 });
  }

  const cfg = getBrokerConfig();
  if (cfg.provider !== "fyers") {
    return new Response("Live tick streaming is only available in Fyers broker mode.", { status: 400 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (obj: unknown) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { /* stream already closed */ }
      };
      send({ type: "connected", symbol });

      unsubscribe = subscribeFyersTick(symbol, cfg.fyers.appId, cfg.fyers.accessToken, (tick) => {
        send({ type: "tick", symbol: tick.symbol, ltp: tick.ltp, ts: tick.ts });
      });

      // Keep the connection alive through proxies/idle timeouts.
      const heartbeat = setInterval(() => send({ type: "heartbeat" }), 15000);
      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe?.();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
    cancel() {
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
