// Paper-trading engine tests — pure sizing / PnL / guardrail functions (no DB).
// Run with: npm run test  (bundled via scripts/run-test.mjs)

import assert from "node:assert";
import type { Trade, User } from "../../shared/types";
import { canCloseNow, checkStops, realizedPnl, sizePosition, unrealizedPnl } from "./paperTrading";

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
    ai_model: null,
    analysis_timeframe: "1d",
    strategy_notes: null,
    short_timeframe: 0,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

function makeTrade(over: Partial<Trade> = {}): Trade {
  return {
    id: 1,
    user_id: 1,
    asset_id: 1,
    symbol: "AAPL",
    category: "stock",
    side: "long",
    status: "open",
    quantity: 10,
    entry_price: 100,
    entry_time: new Date().toISOString(),
    exit_price: null,
    exit_time: null,
    stop_loss: 95,
    take_profit: 115,
    position_value: 1000,
    risk_amount: 50,
    pnl: null,
    pnl_pct: null,
    fees: 0,
    exit_reason: null,
    ai_rationale: null,
    ai_log_id: null,
    confidence: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

// --- sizing: medium = 2% risk; entry 100 / stop 90 → qty 200, notional 20k ---
{
  const s = sizePosition(makeUser(), "long", 100, 90, 120);
  assert.equal(s.riskAmount, 2000);
  assert.equal(s.quantity, 200);
  assert.equal(s.positionValue, 20000);
  assert.equal(s.stopLoss, 90);
  assert.equal(s.takeProfit, 120);
}

// --- notional cap: entry 200 / stop 190 would be 40k > 35% cap → trimmed to 35k ---
{
  const s = sizePosition(makeUser(), "long", 200, 190, 230);
  assert.equal(s.positionValue, 35000);
  assert.equal(s.quantity, 175);
}

// --- invalid stop (above entry on a long) is repaired to a default % stop ---
{
  const s = sizePosition(makeUser(), "long", 100, 110, 0);
  assert.ok(s.stopLoss < 100, "repaired stop sits below entry");
  assert.ok(s.takeProfit > 100, "default target sits above entry");
}

// --- high risk = 5% ---
{
  const s = sizePosition(makeUser({ risk_level: "high" }), "long", 100, 90, 120);
  assert.equal(s.riskAmount, 5000);
  assert.equal(s.quantity, 500);
}

// --- short sizing: stop must sit above entry, target below ---
{
  const s = sizePosition(makeUser({ allow_shorting: 1 }), "short", 100, 110, 80);
  assert.equal(s.stopLoss, 110);
  assert.equal(s.takeProfit, 80);
  assert.ok(s.quantity > 0);
}

// --- realized / unrealized PnL ---
{
  const long = makeTrade({ side: "long", quantity: 10, entry_price: 100 });
  assert.equal(realizedPnl(long, 110), 100);
  assert.equal(unrealizedPnl(long, 90), -100);
  const short = makeTrade({ side: "short", quantity: 10, entry_price: 100 });
  assert.equal(realizedPnl(short, 90), 100);
  assert.equal(realizedPnl(short, 110), -100);
}

// --- stop / target detection ---
{
  const long = makeTrade({ side: "long", stop_loss: 95, take_profit: 115 });
  assert.equal(checkStops(long, 94), "stop_loss");
  assert.equal(checkStops(long, 116), "take_profit");
  assert.equal(checkStops(long, 100), null);
  const short = makeTrade({ side: "short", stop_loss: 105, take_profit: 90 });
  assert.equal(checkStops(short, 106), "stop_loss");
  assert.equal(checkStops(short, 89), "take_profit");
  assert.equal(checkStops(short, 100), null);
}

// --- min-hold guardrail ---
{
  const justOpened = makeTrade({ entry_time: new Date().toISOString() });
  assert.equal(canCloseNow(justOpened, makeUser({ min_hold_hours: 8 })), false);
  const old = makeTrade({ entry_time: new Date(Date.now() - 10 * 3600 * 1000).toISOString() });
  assert.equal(canCloseNow(old, makeUser({ min_hold_hours: 8 })), true);
}

console.log("✓ paper-trading test passed");
