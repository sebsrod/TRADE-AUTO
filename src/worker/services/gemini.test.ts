// Gemini client tests — mocks the REST fetch so no API key / network is needed.
// Run with: npm run test  (bundled via scripts/run-test.mjs)

import assert from "node:assert";
import type { Asset, Indicators, User } from "../../shared/types";
import type { Env } from "../types";
import { analyzeAsset, discoverOpportunities, extractJson } from "./gemini";

function makeUser(over: Partial<User> = {}): User {
  return {
    id: 1,
    name: "test",
    starting_balance: 100000,
    cash_balance: 100000,
    risk_level: "medium",
    min_hold_hours: 8,
    max_trades_per_day: 3,
    max_open_positions: 10,
    auto_trade_enabled: 0,
    allow_shorting: 0,
    gemini_model: null,
    analysis_timeframe: "1d",
    created_at: "",
    updated_at: "",
    ...over,
  };
}

function makeAsset(over: Partial<Asset> = {}): Asset {
  return {
    id: 1,
    symbol: "AAPL",
    display_symbol: "AAPL",
    name: "Apple",
    category: "stock",
    data_source: "yahoo",
    quote_currency: "USD",
    whitelisted: 1,
    active: 1,
    created_at: "",
    ...over,
  };
}

function makeInd(over: Partial<Indicators> = {}): Indicators {
  return {
    price: 100,
    sma20: 98,
    sma50: 95,
    sma200: 90,
    ema12: 99,
    ema26: 97,
    rsi14: 28,
    macd: 0.5,
    macdSignal: 0.3,
    macdHist: 0.2,
    bbUpper: 110,
    bbLower: 90,
    bbMid: 100,
    atr14: 3,
    high52: 130,
    low52: 80,
    changePct24h: 1.2,
    trend: "up",
    ...over,
  };
}

const env = { GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-2.5-flash" } as Env;

function mockGemini(payload: unknown) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
      status: 200,
    })) as typeof fetch;
}

// --- extractJson ---
assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
assert.deepEqual(extractJson('here is the result: {"a":2} thanks'), { a: 2 });
assert.deepEqual(extractJson("[1,2,3]"), [1, 2, 3]);
assert.equal(extractJson("not json at all"), null);

// --- analyzeAsset: BUY ---
mockGemini({
  decision: "BUY",
  side: "long",
  confidence: 0.8,
  sentiment: "bullish",
  rationale: "RSI oversold bounce with MACD cross",
  entry: 100,
  stopLoss: 95,
  takeProfit: 115,
  riskReward: 3,
  timeHorizonHours: 12,
});
{
  const { decision } = await analyzeAsset(env, makeUser(), makeAsset(), makeInd(), [98, 99, 100], false);
  assert.equal(decision.decision, "BUY");
  assert.equal(decision.side, "long");
  assert.equal(decision.entry, 100);
  assert.equal(decision.stopLoss, 95);
  assert.equal(decision.takeProfit, 115);
  assert.equal(decision.confidence, 0.8);
  assert.ok(Math.abs(decision.riskReward - 3) < 0.01, "riskReward recomputed = 15/5 = 3");
}

// --- SELL is downgraded to HOLD when shorting is disabled ---
mockGemini({
  decision: "SELL",
  side: "short",
  confidence: 0.7,
  sentiment: "bearish",
  rationale: "breakdown",
  entry: 100,
  stopLoss: 105,
  takeProfit: 90,
  riskReward: 2,
  timeHorizonHours: 10,
});
{
  const { decision } = await analyzeAsset(env, makeUser({ allow_shorting: 0 }), makeAsset(), makeInd(), [100], false);
  assert.equal(decision.decision, "HOLD");
}

// --- SELL allowed when shorting is enabled ---
{
  const { decision } = await analyzeAsset(env, makeUser({ allow_shorting: 1 }), makeAsset(), makeInd(), [100], false);
  assert.equal(decision.decision, "SELL");
  assert.equal(decision.side, "short");
}

// --- confidence clamped, garbage decision defaults to HOLD ---
mockGemini({ decision: "MAYBE", confidence: 5, rationale: "?", entry: 100, stopLoss: 0, takeProfit: 0 });
{
  const { decision } = await analyzeAsset(env, makeUser(), makeAsset(), makeInd(), [100], false);
  assert.equal(decision.decision, "HOLD");
  assert.ok(decision.confidence <= 1 && decision.confidence >= 0);
}

// --- discovery: filters symbols outside the provided universe ---
mockGemini({
  commentary: "Markets are calm; best risk/reward in tech.",
  ideas: [
    { symbol: "AAPL", direction: "long", strategy: "RSI reversal", rationale: "y", indicatorsHit: ["RSI<30"], riskReward: 2, entry: 100, stopLoss: 95, takeProfit: 110, confidence: 0.7 },
    { symbol: "ZZZZ", direction: "long", strategy: "x", rationale: "y", indicatorsHit: [], riskReward: 1, entry: 1, stopLoss: 1, takeProfit: 1, confidence: 0.9 },
  ],
});
{
  const disc = await discoverOpportunities(env, makeUser(), [{ asset: makeAsset(), ind: makeInd() }], 5);
  assert.equal(disc.ideas.length, 1, "ZZZZ (not in universe) is filtered out");
  assert.equal(disc.ideas[0].symbol, "AAPL");
  assert.equal(disc.commentary, "Markets are calm; best risk/reward in tech.");
}

console.log("✓ gemini mock test passed");
