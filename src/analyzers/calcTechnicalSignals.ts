import type { NavRecord } from "../types/fund.js";
import type { TechnicalSignal } from "../types/indexFund.js";

/** Calculate simple moving average of the last N accNav values */
function calcMA(accNavs: number[], n: number): number {
  if (accNavs.length < n) return 0;
  const slice = accNavs.slice(-n);
  return slice.reduce((s, v) => s + v, 0) / n;
}

/** Calculate RSI(14) from accNav series */
function calcRSI(accNavs: number[], period = 14): number {
  if (accNavs.length < period + 1) return 50; // neutral default
  // Use last (period+1) values to get `period` changes
  const recent = accNavs.slice(-(period + 1));
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i < recent.length; i++) {
    const change = recent[i] - recent[i - 1];
    if (change > 0) gainSum += change;
    else lossSum += -change;
  }
  const avgGain = gainSum / period;
  const avgLoss = lossSum / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 100) / 100;
}

/** Determine direction from MA alignment and RSI */
function calcDirection(
  price: number,
  ma5: number,
  ma20: number,
  ma60: number,
  rsi: number,
): TechnicalSignal["direction"] {
  let bullCount = 0;
  let bearCount = 0;

  // Price above/below MAs
  if (ma5 > 0 && price > ma5) bullCount++;
  else if (ma5 > 0) bearCount++;

  if (ma20 > 0 && price > ma20) bullCount++;
  else if (ma20 > 0) bearCount++;

  if (ma60 > 0 && price > ma60) bullCount++;
  else if (ma60 > 0) bearCount++;

  // MA alignment: short > long = bullish
  if (ma5 > 0 && ma20 > 0 && ma5 > ma20) bullCount++;
  else if (ma5 > 0 && ma20 > 0) bearCount++;

  if (ma20 > 0 && ma60 > 0 && ma20 > ma60) bullCount++;
  else if (ma20 > 0 && ma60 > 0) bearCount++;

  // RSI
  if (rsi > 60) bullCount++;
  else if (rsi < 40) bearCount++;

  if (bullCount >= 4) return "bullish";
  if (bearCount >= 4) return "bearish";
  return "neutral";
}

/** @entry Calculate technical signals from NAV history (uses accNav) */
export function calcTechnicalSignals(navRecords: NavRecord[]): TechnicalSignal {
  const accNavs = navRecords.map((r) => r.accNav);
  const price = accNavs.length > 0 ? accNavs[accNavs.length - 1] : 0;

  const ma5 = Math.round(calcMA(accNavs, 5) * 10000) / 10000;
  const ma20 = Math.round(calcMA(accNavs, 20) * 10000) / 10000;
  const ma60 = Math.round(calcMA(accNavs, 60) * 10000) / 10000;
  const rsi = calcRSI(accNavs, 14);
  const direction = calcDirection(price, ma5, ma20, ma60, rsi);

  return { ma5, ma20, ma60, rsi, direction };
}
