// Claude service tests — exercise the pure parsing/normalization helpers directly
// (no network, no API key). Run with: npm run test (bundled via scripts/run-test.mjs)

import assert from "node:assert";
import { extractJson, ideasFromParsed, normalizeDecision } from "./claude";

// --- extractJson ---
assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
assert.deepEqual(extractJson('here is the result: {"a":2} thanks'), { a: 2 });
assert.deepEqual(extractJson("[1,2,3]"), [1, 2, 3]);
assert.equal(extractJson("not json at all"), null);

// --- normalizeDecision: BUY ---
{
  const decision = normalizeDecision(
    {
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
    },
    100,
    false,
  );
  assert.equal(decision.decision, "BUY");
  assert.equal(decision.side, "long");
  assert.equal(decision.entry, 100);
  assert.equal(decision.stopLoss, 95);
  assert.equal(decision.takeProfit, 115);
  assert.equal(decision.confidence, 0.8);
  assert.ok(Math.abs(decision.riskReward - 3) < 0.01, "riskReward recomputed = 15/5 = 3");
}

// --- SELL is downgraded to HOLD when shorting is disabled ---
{
  const decision = normalizeDecision(
    { decision: "SELL", side: "short", confidence: 0.7, entry: 100, stopLoss: 105, takeProfit: 90 },
    100,
    false,
  );
  assert.equal(decision.decision, "HOLD");
}

// --- SELL allowed when shorting is enabled ---
{
  const decision = normalizeDecision(
    { decision: "SELL", side: "short", confidence: 0.7, entry: 100, stopLoss: 105, takeProfit: 90 },
    100,
    true,
  );
  assert.equal(decision.decision, "SELL");
  assert.equal(decision.side, "short");
}

// --- confidence clamped, garbage decision defaults to HOLD ---
{
  const decision = normalizeDecision(
    { decision: "MAYBE", confidence: 5, rationale: "?", entry: 100, stopLoss: 0, takeProfit: 0 },
    100,
    false,
  );
  assert.equal(decision.decision, "HOLD");
  assert.ok(decision.confidence <= 1 && decision.confidence >= 0);
}

// --- discovery: filters symbols outside the provided universe ---
{
  const ideas = ideasFromParsed(
    {
      commentary: "Markets are calm; best risk/reward in tech.",
      ideas: [
        { symbol: "AAPL", direction: "long", strategy: "RSI reversal", rationale: "y", indicatorsHit: ["RSI<30"], riskReward: 2, entry: 100, stopLoss: 95, takeProfit: 110, confidence: 0.7 },
        { symbol: "ZZZZ", direction: "long", strategy: "x", rationale: "y", indicatorsHit: [], riskReward: 1, entry: 1, stopLoss: 1, takeProfit: 1, confidence: 0.9 },
      ],
    },
    new Set(["AAPL"]),
    5,
  );
  assert.equal(ideas.length, 1, "ZZZZ (not in universe) is filtered out");
  assert.equal(ideas[0].symbol, "AAPL");
}

console.log("✓ claude service test passed");
