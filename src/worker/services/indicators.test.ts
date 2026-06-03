// Lightweight smoke test for the indicator math. Run with: npm run test:indicators
// (Node >= 23 strips the TypeScript types automatically.)

import assert from "node:assert";
import type { Candle } from "../../shared/types";
import { atr, bollinger, computeIndicators, ema, macd, rsi, sma } from "./indicators.ts";

function approx(a: number, b: number, eps = 1e-6) {
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);
}

// --- SMA ---
{
  const out = sma([1, 2, 3, 4, 5], 5);
  approx(out[4] as number, 3);
  assert.equal(out[3], null);
}

// --- EMA ---
{
  const out = ema([1, 2, 3, 4, 5, 6, 7, 8], 3);
  assert.equal(out[1], null);
  assert.ok((out[7] as number) > (out[2] as number), "EMA should rise on a rising series");
}

// --- RSI bounds + behavior ---
{
  const rising = Array.from({ length: 40 }, (_, i) => 100 + i);
  const r = rsi(rising, 14);
  const lastR = r[r.length - 1] as number;
  assert.ok(lastR > 90, `pure uptrend RSI should be very high, got ${lastR}`);

  const noisy = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 2) * 5);
  for (const v of rsi(noisy, 14)) {
    if (v != null) assert.ok(v >= 0 && v <= 100, `RSI out of bounds: ${v}`);
  }
}

// --- MACD shape ---
{
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 0.5);
  const m = macd(closes);
  assert.equal(m.macd.length, closes.length);
  assert.equal(m.signal.length, closes.length);
  assert.ok((m.macd[m.macd.length - 1] as number) > 0, "uptrend MACD line should be positive");
}

// --- Bollinger ---
{
  const closes = Array.from({ length: 30 }, (_, i) => 50 + (i % 5));
  const bb = bollinger(closes, 20, 2);
  const i = closes.length - 1;
  assert.ok((bb.upper[i] as number) > (bb.mid[i] as number));
  assert.ok((bb.mid[i] as number) > (bb.lower[i] as number));
}

// --- ATR ---
{
  const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
    t: i,
    o: 100 + i,
    h: 102 + i,
    l: 99 + i,
    c: 101 + i,
    v: 1000,
  }));
  const a = atr(candles, 14);
  assert.ok((a[a.length - 1] as number) > 0, "ATR should be positive");
}

// --- computeIndicators end-to-end ---
{
  const candles: Candle[] = Array.from({ length: 250 }, (_, i) => {
    const base = 100 + i * 0.4;
    return { t: i, o: base, h: base + 1, l: base - 1, c: base, v: 1000 + i };
  });
  const ind = computeIndicators(candles);
  assert.ok(Number.isFinite(ind.price), "price finite");
  assert.equal(ind.trend, "up");
  assert.ok((ind.rsi14 as number) > 70, "uptrend RSI high");
  assert.ok((ind.sma20 as number) < ind.price, "price above SMA20 in uptrend");
  assert.ok(ind.high52 != null && ind.high52 >= ind.price - 1);
}

console.log("✓ indicators smoke test passed");
