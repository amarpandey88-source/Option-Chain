// Indicative Fyers Standard round-trip estimate for index options. Statutory
// rates and exchange levies can change; reconcile estimates against the
// broker contract note. Users can replace an estimate with actual charges.
const FYERS_BROKERAGE_PER_ORDER = 20;
const OPTIONS_STT_SELL_RATE = 0.0015;
const NSE_OPTIONS_TRANSACTION_RATE = 0.0003503;
const SEBI_TURNOVER_RATE = 0.000001;
const OPTIONS_STAMP_BUY_RATE = 0.00003;
const GST_RATE = 0.18;

export function estimateFyersOptionsCharges(entryPremium: number, exitPremium: number, quantity: number): number {
  if (![entryPremium, exitPremium, quantity].every(Number.isFinite) ||
      entryPremium <= 0 || exitPremium <= 0 || quantity <= 0) return 0;

  const buyTurnover = entryPremium * quantity;
  const sellTurnover = exitPremium * quantity;
  const turnover = buyTurnover + sellTurnover;
  const brokerage = FYERS_BROKERAGE_PER_ORDER * 2;
  const exchangeCharges = turnover * NSE_OPTIONS_TRANSACTION_RATE;
  const sebiCharges = turnover * SEBI_TURNOVER_RATE;
  const stampDuty = buyTurnover * OPTIONS_STAMP_BUY_RATE;
  const stt = sellTurnover * OPTIONS_STT_SELL_RATE;
  const gst = (brokerage + exchangeCharges + sebiCharges) * GST_RATE;

  return Number((brokerage + exchangeCharges + sebiCharges + stampDuty + stt + gst).toFixed(2));
}

export interface JournalFinancialRecord {
  dataSource: string;
  status: string;
  entryPremium: number;
  exitPremium: number | null;
  totalPnl: number | null;
  tradingCharges: number;
  chargesEstimated: boolean;
  netPnl: number | null;
  symbol: string;
}

export function withCalculatedFyersCharges<T extends JournalFinancialRecord>(trade: T) {
  const isClosedFyersTrade = trade.status !== "OPEN" &&
    trade.totalPnl !== null &&
    trade.exitPremium !== null &&
    trade.exitPremium > 0 &&
    trade.dataSource.toLowerCase().includes("fyers");
  const chargesEstimated = isClosedFyersTrade && trade.chargesEstimated;
  const tradingCharges = chargesEstimated && trade.tradingCharges === 0
    ? estimateFyersOptionsCharges(
      trade.entryPremium,
      trade.exitPremium!,
      trade.symbol === "BANKNIFTY" ? 30 : trade.symbol === "SENSEX" ? 20 : 65,
    )
    : trade.tradingCharges;
  return {
    ...trade,
    tradingCharges,
    netPnl: trade.totalPnl === null ? trade.netPnl : trade.totalPnl - tradingCharges,
    chargesEstimated,
  };
}
