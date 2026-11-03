"""Line-oriented worker used by the Next.js Pandas bridge."""

from __future__ import annotations

import json
import math
import sys
from typing import Any

from market_dataframe import SignalWindow, add_greeks, option_chain_dataframe

windows: dict[str, SignalWindow] = {}


def json_value(value: Any) -> Any:
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if hasattr(value, "item"):
        return json_value(value.item())
    if isinstance(value, dict):
        return {key: json_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_value(item) for item in value]
    return value


def handle(message: dict[str, Any]) -> dict[str, Any]:
    symbol = str(message["symbol"])
    chain = option_chain_dataframe(
        message.get("chain", []), symbol=symbol, spot=message.get("spot"),
        expiry=message.get("expiry"), timestamp=message.get("timestamp"),
        atm_strike=message.get("atmStrike"),
    )
    chain = add_greeks(chain, days_to_expiry=float(message.get("daysToExpiry", 0)))
    window = windows.setdefault(symbol, SignalWindow(max_rows=120))
    signal = window.add_tick(
        spot=message.get("spot"), pcr=message.get("pcr"),
        india_vix=message.get("indiaVix"), timestamp=message.get("timestamp"),
    )
    return {
        "requestId": message.get("requestId"), "ok": True,
        "optionChain": chain.to_dict(orient="records"),
        "signals": signal.iloc[-1].to_dict() if not signal.empty else {},
        "sampleCount": len(window.dataframe),
    }


for line in sys.stdin:
    try:
        response = handle(json.loads(line))
    except Exception as error:  # Keep the worker alive for the next snapshot.
        response = {"requestId": None, "ok": False, "error": str(error)}
    sys.stdout.write(json.dumps(json_value(response), separators=(",", ":")) + "\n")
    sys.stdout.flush()