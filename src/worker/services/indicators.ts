// Technical indicators computed locally from raw OHLCV — no external indicator API.
// All functions are pure and operate on plain number arrays.

import type { Candle, Indicators } from "../../shared/types";

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  // Seed with the SMA of the first `period` values.
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// Wilder's RSI.
export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gainSum += change;
    else lossSum -= change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = rsiFrom(avgGain, avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = rsiFrom(avgGain, avgLoss);
  }
  return out;
}

function rsiFrom(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface MacdSeries {
  macd: (number | null)[];
  signal: (number | null)[];
  hist: (number | null)[];
}

export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdSeries {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine: (number | null)[] = closes.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null
      ? (emaFast[i] as number) - (emaSlow[i] as number)
      : null,
  );
  // Signal = EMA of the (defined portion of the) MACD line.
  const firstIdx = macdLine.findIndex((v) => v != null);
  const signal: (number | null)[] = new Array(closes.length).fill(null);
  const hist: (number | null)[] = new Array(closes.length).fill(null);
  if (firstIdx >= 0) {
    const defined = macdLine.slice(firstIdx).map((v) => v as number);
    const sig = ema(defined, signalPeriod);
    for (let i = 0; i < sig.length; i++) {
      const idx = firstIdx + i;
      signal[idx] = sig[i];
      if (sig[i] != null && macdLine[idx] != null) {
        hist[idx] = (macdLine[idx] as number) - (sig[i] as number);
      }
    }
  }
  return { macd: macdLine, signal, hist };
}

export interface BollingerSeries {
  upper: (number | null)[];
  mid: (number | null)[];
  lower: (number | null)[];
}

export function bollinger(
  closes: number[],
  period = 20,
  mult = 2,
): BollingerSeries {
  const mid = sma(closes, period);
  const upper: (number | null)[] = new Array(closes.length).fill(null);
  const lower: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const m = mid[i];
    if (m == null) continue;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      variance += (closes[j] - m) ** 2;
    }
    const sd = Math.sqrt(variance / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { upper, mid, lower };
}

// Wilder's ATR.
export function atr(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const tr: number[] = new Array(candles.length).fill(0);
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      tr[i] = candles[i].h - candles[i].l;
      continue;
    }
    const prevClose = candles[i - 1].c;
    tr[i] = Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - prevClose),
      Math.abs(candles[i].l - prevClose),
    );
  }
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  let prev = sum / period;
  out[period] = prev;
  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

const last = (arr: (number | null)[]): number | null => {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null) return arr[i];
  }
  return null;
};

// Compute the full indicator snapshot used for AI prompts + the UI.
export function computeIndicators(candles: Candle[]): Indicators {
  const closes = candles.map((c) => c.c);
  const price = closes.length ? closes[closes.length - 1] : 0;

  const sma20 = last(sma(closes, 20));
  const sma50 = last(sma(closes, 50));
  const sma200 = last(sma(closes, 200));
  const ema12 = last(ema(closes, 12));
  const ema26 = last(ema(closes, 26));
  const rsi14 = last(rsi(closes, 14));
  const m = macd(closes);
  const macdVal = last(m.macd);
  const macdSignal = last(m.signal);
  const macdHist = last(m.hist);
  const bb = bollinger(closes);
  const bbUpper = last(bb.upper);
  const bbLower = last(bb.lower);
  const bbMid = last(bb.mid);
  const atr14 = last(atr(candles, 14));

  const window = closes.slice(-260); // ~52 weeks of daily / recent window
  const high52 = window.length ? Math.max(...window) : null;
  const low52 = window.length ? Math.min(...window) : null;

  let changePct24h: number | null = null;
  if (closes.length >= 2) {
    const prev = closes[closes.length - 2];
    if (prev) changePct24h = ((price - prev) / prev) * 100;
  }

  let trend: Indicators["trend"] = "sideways";
  if (sma20 != null && sma50 != null) {
    if (price > sma20 && sma20 > sma50) trend = "up";
    else if (price < sma20 && sma20 < sma50) trend = "down";
  } else if (sma20 != null) {
    trend = price > sma20 ? "up" : price < sma20 ? "down" : "sideways";
  }

  return {
    price,
    sma20,
    sma50,
    sma200,
    ema12,
    ema26,
    rsi14,
    macd: macdVal,
    macdSignal,
    macdHist,
    bbUpper,
    bbLower,
    bbMid,
    atr14,
    high52,
    low52,
    changePct24h,
    trend,
  };
}
