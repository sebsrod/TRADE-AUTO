import { Hono } from "hono";
import type { AppBindings } from "../types";
import type { LivePortfolio, PortfolioResponse } from "../../shared/types";
import { getUser, listEquityHistory, listOpenTrades, listTrades } from "../db";
import { computeMetrics } from "../services/metrics";
import { enrichPositions, enrichPositionsLive } from "../services/analysisEngine";
import { sanitizeUser } from "../services/auth";

const portfolio = new Hono<AppBindings>();

// GET the full portfolio snapshot: user config, metrics, and open positions
// (priced from the snapshot cache — fine for the initial dashboard load).
portfolio.get("/", async (c) => {
  const user = await getUser(c.env, c.get("userId"));
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const open = await listOpenTrades(c.env, user.id);
  const positions = await enrichPositions(c.env, user, open);
  const closed = await listTrades(c.env, user.id, { status: "closed", limit: 1000 });
  const equity = await listEquityHistory(c.env, user.id, 500);
  const metrics = computeMetrics(user, closed, positions, equity);
  const res: PortfolioResponse = { user: sanitizeUser(user), metrics, positions };
  return c.json(res);
});

// GET the fast live snapshot: positions repriced at the latest spot quote +
// freshly recomputed metrics. Polled every few seconds so the P&L actually moves.
portfolio.get("/live", async (c) => {
  const user = await getUser(c.env, c.get("userId"));
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const open = await listOpenTrades(c.env, user.id);
  const positions = await enrichPositionsLive(c.env, user, open);
  const closed = await listTrades(c.env, user.id, { status: "closed", limit: 1000 });
  const equity = await listEquityHistory(c.env, user.id, 500);
  const metrics = computeMetrics(user, closed, positions, equity);
  const res: LivePortfolio = { positions, metrics, asOf: new Date().toISOString() };
  return c.json(res);
});

// GET metrics only (lighter than the full portfolio).
portfolio.get("/metrics", async (c) => {
  const user = await getUser(c.env, c.get("userId"));
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const open = await listOpenTrades(c.env, user.id);
  const positions = await enrichPositions(c.env, user, open);
  const closed = await listTrades(c.env, user.id, { status: "closed", limit: 1000 });
  const equity = await listEquityHistory(c.env, user.id, 500);
  return c.json(computeMetrics(user, closed, positions, equity));
});

// GET the equity curve for drawdown / ROI charts.
portfolio.get("/equity", async (c) => {
  const user = await getUser(c.env, c.get("userId"));
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const limit = parseInt(c.req.query("limit") ?? "500", 10);
  const history = await listEquityHistory(c.env, user.id, Number.isFinite(limit) ? limit : 500);
  return c.json(history);
});

export default portfolio;
