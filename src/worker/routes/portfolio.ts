import { Hono } from "hono";
import type { Env } from "../types";
import type { PortfolioResponse } from "../../shared/types";
import { defaultUserId, ensureUser, listEquityHistory, listOpenTrades, listTrades } from "../db";
import { computeMetrics } from "../services/metrics";
import { enrichPositions } from "../services/analysisEngine";

const portfolio = new Hono<{ Bindings: Env }>();

// GET the full portfolio snapshot: user config, metrics, and live open positions.
portfolio.get("/", async (c) => {
  const user = await ensureUser(c.env, defaultUserId(c.env));
  const open = await listOpenTrades(c.env, user.id);
  const positions = await enrichPositions(c.env, user, open);
  const closed = await listTrades(c.env, user.id, { status: "closed", limit: 1000 });
  const equity = await listEquityHistory(c.env, user.id, 500);
  const metrics = computeMetrics(user, closed, positions, equity);
  const res: PortfolioResponse = { user, metrics, positions };
  return c.json(res);
});

// GET metrics only (lighter than the full portfolio).
portfolio.get("/metrics", async (c) => {
  const user = await ensureUser(c.env, defaultUserId(c.env));
  const open = await listOpenTrades(c.env, user.id);
  const positions = await enrichPositions(c.env, user, open);
  const closed = await listTrades(c.env, user.id, { status: "closed", limit: 1000 });
  const equity = await listEquityHistory(c.env, user.id, 500);
  return c.json(computeMetrics(user, closed, positions, equity));
});

// GET the equity curve for drawdown / ROI charts.
portfolio.get("/equity", async (c) => {
  const user = await ensureUser(c.env, defaultUserId(c.env));
  const limit = parseInt(c.req.query("limit") ?? "500", 10);
  const history = await listEquityHistory(c.env, user.id, Number.isFinite(limit) ? limit : 500);
  return c.json(history);
});

export default portfolio;
