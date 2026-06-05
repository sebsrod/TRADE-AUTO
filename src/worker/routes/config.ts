import { Hono } from "hono";
import type { AppBindings } from "../types";
import type { RiskLevel, Timeframe, User } from "../../shared/types";
import { TIMEFRAMES } from "../../shared/types";
import { getUser, updateUser } from "../db";
import { sanitizeUser } from "../services/auth";
import { clamp, num } from "../util";

const config = new Hono<AppBindings>();

// GET current user / global trading configuration.
config.get("/", async (c) => {
  const user = await getUser(c.env, c.get("userId"));
  if (!user) return c.json({ error: "unauthorized" }, 401);
  return c.json(sanitizeUser(user));
});

// PATCH trading configuration (risk, timeframes, balances, toggles).
config.patch("/", async (c) => {
  const user = await getUser(c.env, c.get("userId"));
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Partial<User> = {};

  if (typeof body.name === "string") patch.name = body.name.slice(0, 80);
  if (body.risk_level && ["low", "medium", "high"].includes(String(body.risk_level))) {
    patch.risk_level = body.risk_level as RiskLevel;
  }
  if (body.min_hold_hours !== undefined) patch.min_hold_hours = clamp(num(body.min_hold_hours, 8), 0, 720);
  if (body.max_trades_per_day !== undefined) {
    patch.max_trades_per_day = Math.round(clamp(num(body.max_trades_per_day, 3), 1, 100));
  }
  if (body.max_open_positions !== undefined) {
    patch.max_open_positions = Math.round(clamp(num(body.max_open_positions, 10), 1, 200));
  }
  if (body.auto_trade_enabled !== undefined) patch.auto_trade_enabled = body.auto_trade_enabled ? 1 : 0;
  if (body.allow_shorting !== undefined) patch.allow_shorting = body.allow_shorting ? 1 : 0;
  if (body.gemini_model !== undefined) {
    patch.gemini_model = body.gemini_model ? String(body.gemini_model).slice(0, 60) : null;
  }
  if (body.analysis_timeframe && (TIMEFRAMES as string[]).includes(String(body.analysis_timeframe))) {
    patch.analysis_timeframe = body.analysis_timeframe as Timeframe;
  }
  if (body.strategy_notes !== undefined) {
    const notes = body.strategy_notes == null ? null : String(body.strategy_notes).slice(0, 2000);
    patch.strategy_notes = notes && notes.trim() ? notes : null;
  }
  if (body.starting_balance !== undefined) {
    patch.starting_balance = clamp(num(body.starting_balance, 100000), 100, 1_000_000_000);
  }

  const updated = await updateUser(c.env, user.id, patch);
  return c.json(sanitizeUser(updated));
});

// POST reset the paper account: restore cash, wipe trades/equity/suggestions.
config.post("/reset", async (c) => {
  const env = c.env;
  const user = await getUser(env, c.get("userId"));
  if (!user) return c.json({ error: "unauthorized" }, 401);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM trades WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM equity_history WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM suggestions WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM ai_logs WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM chat_messages WHERE user_id = ?").bind(user.id),
    env.DB.prepare(
      "UPDATE users SET cash_balance = starting_balance, updated_at = datetime('now') WHERE id = ?",
    ).bind(user.id),
  ]);
  const fresh = await getUser(env, user.id);
  return c.json({ ok: true, user: fresh ? sanitizeUser(fresh) : null });
});

export default config;
