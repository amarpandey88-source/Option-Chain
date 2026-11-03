"""Pandas data layer for Fyers option-chain and live signal samples."""

from __future__ import annotations

from dataclasses import dataclass
from math import erf, exp, log, pi, sqrt
from typing import Any, Iterable, Mapping

import numpy as np
import pandas as pd

OPTION_COLUMNS = [
    "timestamp", "symbol", "expiry", "spot", "strike", "is_atm",
    "call_ltp", "call_oi", "call_oi_change", "call_iv",
    "put_ltp", "put_oi", "put_oi_change", "put_iv",
]


def _first(row: Mapping[str, Any], *keys: str, default: Any = np.nan) -> Any:
    for key in keys:
        value = row.get(key)
        if value is not None and value != "":
            return value
    return default


def _number(value: Any) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return np.nan
    return result if np.isfinite(result) else np.nan


def _timestamp(value: Any = None) -> pd.Timestamp:
    if value is None:
        return pd.Timestamp.now(tz="UTC")
    parsed = pd.to_datetime(value, utc=True, errors="coerce")
    return parsed if not pd.isna(parsed) else pd.Timestamp.now(tz="UTC")


def _normalise_row(row: Mapping[str, Any], *, symbol: str, spot: float,
                   expiry: str | None, timestamp: Any,
                   atm_strike: float | None) -> dict[str, Any]:
    strike = _number(_first(row, "strike", "strikePrice", "StrikeRate"))
    resolved_atm = atm_strike if atm_strike is not None else _number(_first(row, "atmStrike"))
    is_atm = bool(row.get("isATM", row.get("is_atm", False)))
    if not is_atm and np.isfinite(strike) and np.isfinite(resolved_atm):
        is_atm = strike == resolved_atm
    return {
        "timestamp": _timestamp(timestamp), "symbol": symbol, "expiry": expiry,
        "spot": _number(spot), "strike": strike, "is_atm": is_atm,
        "call_ltp": _number(_first(row, "call_ltp", "ceLtp", "ceLTP", "callLTP")),
        "call_oi": _number(_first(row, "call_oi", "ceOi", "ceOI", "callOI")),
        "call_oi_change": _number(_first(row, "call_oi_change", "ceOiChg", "ceOIChange", "callOIChange")),
        "call_iv": _number(_first(row, "call_iv", "ceIv", "ceIV", "callIV")),
        "put_ltp": _number(_first(row, "put_ltp", "peLtp", "peLTP", "putLTP")),
        "put_oi": _number(_first(row, "put_oi", "peOi", "peOI", "putOI")),
        "put_oi_change": _number(_first(row, "put_oi_change", "peOiChg", "peOIChange", "putOIChange")),
        "put_iv": _number(_first(row, "put_iv", "peIv", "peIV", "putIV")),
    }


def option_chain_dataframe(rows: Iterable[Mapping[str, Any]], *, symbol: str,
                           spot: float, expiry: str | None = None,
                           timestamp: Any = None,
                           atm_strike: float | None = None) -> pd.DataFrame:
    """Normalize app or common Fyers option-chain rows into a DataFrame."""
    frame = pd.DataFrame([
        _normalise_row(row, symbol=symbol, spot=spot, expiry=expiry,
                       timestamp=timestamp, atm_strike=atm_strike)
        for row in rows
    ], columns=OPTION_COLUMNS)
    return frame.sort_values("strike", ignore_index=True) if not frame.empty else frame


def _normal_cdf(value: float) -> float:
    return 0.5 * (1.0 + erf(value / sqrt(2.0)))


def _normal_pdf(value: float) -> float:
    return exp(-0.5 * value * value) / sqrt(2.0 * pi)


def _greeks(spot: float, strike: float, iv_percent: float, days: float,
            is_call: bool) -> tuple[float, float, float, float]:
    if not all(np.isfinite([spot, strike, iv_percent, days])) or min(spot, strike, iv_percent, days) <= 0:
        return (np.nan, np.nan, np.nan, np.nan)
    volatility, time = iv_percent / 100.0, days / 365.0
    d1 = (log(spot / strike) + 0.5 * volatility**2 * time) / (volatility * sqrt(time))
    delta = _normal_cdf(d1) if is_call else _normal_cdf(d1) - 1.0
    gamma = _normal_pdf(d1) / (spot * volatility * sqrt(time))
    theta = -(spot * _normal_pdf(d1) * volatility) / (2 * sqrt(time)) / 365.0
    vega = spot * _normal_pdf(d1) * sqrt(time) / 100.0
    return delta, gamma, theta, vega


def add_greeks(chain: pd.DataFrame, *, days_to_expiry: float,
               atm_only: bool = False) -> pd.DataFrame:
    """Add call/put Greeks; IV is percent, theta per day, vega per 1% IV."""
    result = chain.copy()
    calculate = result["is_atm"] if atm_only else pd.Series(True, index=result.index)
    for side, iv_column in (("call", "call_iv"), ("put", "put_iv")):
        values = result.apply(
            lambda row: _greeks(row["spot"], row["strike"], row[iv_column], days_to_expiry, side == "call")
            if calculate.loc[row.name] else (np.nan, np.nan, np.nan, np.nan),
            axis=1, result_type="expand",
        )
        values.columns = [f"{side}_{name}" for name in ("delta", "gamma", "theta", "vega")]
        result[values.columns] = values
    return result


@dataclass
class SignalWindow:
    """Bounded rolling window for one live sample every five seconds."""

    max_rows: int = 120

    def __post_init__(self) -> None:
        self._data = pd.DataFrame(columns=["timestamp", "spot", "pcr", "india_vix"])

    def add_tick(self, *, spot: float, pcr: float, india_vix: float,
                 timestamp: Any = None) -> pd.DataFrame:
        row = pd.DataFrame([{
            "timestamp": _timestamp(timestamp), "spot": _number(spot),
            "pcr": _number(pcr), "india_vix": _number(india_vix),
        }])
        self._data = row if self._data.empty else pd.concat([self._data, row], ignore_index=True)
        self._data = self._data.tail(self.max_rows)
        return self.calculate()

    def calculate(self) -> pd.DataFrame:
        result = self._data.copy()
        if result.empty:
            return result
        result["ema_9"] = result["spot"].ewm(span=9, adjust=False, min_periods=1).mean()
        result["ema_21"] = result["spot"].ewm(span=21, adjust=False, min_periods=1).mean()
        delta = result["spot"].diff()
        gains = delta.clip(lower=0).ewm(alpha=1 / 14, adjust=False, min_periods=1).mean()
        losses = (-delta.clip(upper=0)).ewm(alpha=1 / 14, adjust=False, min_periods=1).mean()
        result["rsi"] = (100 - (100 / (1 + gains / losses.replace(0, np.nan)))).fillna(50.0).clip(0, 100)
        result["ema_cross"] = np.select(
            [result["ema_9"] > result["ema_21"], result["ema_9"] < result["ema_21"]],
            ["BULLISH", "BEARISH"], default="NEUTRAL",
        )
        rsi_component = ((result["rsi"] - 50.0) * 2.0).clip(-100, 100)
        ema_component = np.where(result["ema_9"] >= result["ema_21"], 100.0, -100.0)
        pcr_component = ((result["pcr"] - 1.0) * 250.0).clip(-100, 100)
        result["directional_score"] = (0.45 * rsi_component + 0.35 * ema_component + 0.20 * pcr_component).round(2)
        result["trend_score"] = (50.0 + result["directional_score"] / 2.0).round(2).clip(0, 100)
        result["trend"] = np.select(
            [result["directional_score"] >= 20, result["directional_score"] <= -20],
            ["UP", "DOWN"], default="FLAT",
        )
        return result

    @property
    def dataframe(self) -> pd.DataFrame:
        return self._data.copy()


def fyers_chain_rows(response: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """Extract rows from common Fyers option-chain response envelopes."""
    data = response.get("data", response)
    if isinstance(data, Mapping):
        for key in ("optionsChain", "options_chain", "chain", "rows"):
            if isinstance(data.get(key), list):
                return data[key]
    return data if isinstance(data, list) else []
