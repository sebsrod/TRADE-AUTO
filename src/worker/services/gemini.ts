// Gemini API wrapper — called over REST (most reliable on the Workers runtime).
// Uses JSON output mode and robustly parses the model's structured response.

import type {
  Asset,
  GeminiDecision,
  GeminiDiscovery,
  Indicators,
  RiskLevel,
  User,
} from "../../shared/types";
import type { Env } from "../types";
import { clamp, num, roundPrice, withTimeout } from "../util";

const GEMINI_TIMEOUT_MS = 30000;
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeminiRawCall {
  text: string;
  model: string;
  grounded: boolean;
  prompt: string;
}

function riskGuidance(level: RiskLevel): string {
  switch (level) {
    case "low":
      return "Conservative: only high-probability setups, tight stops, reward:risk >= 2.0, risking ~1% of capital.";
    case "high":
      return "Aggressive: accept lower-probability/higher-volatility setups, reward:risk >= 1.3, risking ~5% of capital.";
    default:
      return "Balanced: solid setups with clear confluence, reward:risk >= 1.5, risking ~2% of capital.";
  }
}

// Extract a JSON value from model text that may be fenced or prefixed.
export function extractJson<T = any>(text: string): T | null {
  if (!text) return null;
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const tryParse = (s: string): T | null => {
    try {
      return JSON.parse(s) as T;
    } catch {
      return null;
    }
  };
  let v = tryParse(cleaned);
  if (v != null) return v;
  // Find the first balanced { } or [ ] block.
  for (const [open, close] of [["{", "}"], ["[", "]"]] as const) {
    const start = cleaned.indexOf(open);
    const end = cleaned.lastIndexOf(close);
    if (start >= 0 && end > start) {
      v = tryParse(cleaned.slice(start, end + 1));
      if (v != null) return v;
    }
  }
  return null;
}

async function callGemini(
  env: Env,
  model: string,
  prompt: string,
  opts: { grounding?: boolean; temperature?: number; maxTokens?: number } = {},
): Promise<GeminiRawCall> {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured (set it with `wrangler secret put GEMINI_API_KEY`).");
  }
  const grounded = !!opts.grounding;
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      maxOutputTokens: opts.maxTokens ?? 2048,
      // JSON mode and the google_search tool can conflict; only force JSON when not grounding.
      ...(grounded ? {} : { responseMimeType: "application/json" }),
    },
  };
  if (grounded) body.tools = [{ google_search: {} }];

  const url = `${BASE}/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  const res = await withTimeout(
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    GEMINI_TIMEOUT_MS,
    "gemini generateContent",
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini HTTP ${res.status}: ${errText.slice(0, 400)}`);
  }
  const data: any = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p: any) => p?.text ?? "").join("").trim();
  if (!text) {
    const reason = data?.candidates?.[0]?.finishReason ?? "unknown";
    throw new Error(`Gemini returned no text (finishReason=${reason}).`);
  }
  return { text, model, grounded, prompt };
}

function fmt(n: number | null | undefined, dp = 2): string {
  return n == null || !Number.isFinite(n) ? "n/a" : Number(n).toFixed(dp);
}

function indicatorBlock(ind: Indicators): string {
  return [
    `price=${fmt(ind.price, 4)}`,
    `trend=${ind.trend}`,
    `rsi14=${fmt(ind.rsi14)}`,
    `macd=${fmt(ind.macd, 4)} signal=${fmt(ind.macdSignal, 4)} hist=${fmt(ind.macdHist, 4)}`,
    `sma20=${fmt(ind.sma20, 4)} sma50=${fmt(ind.sma50, 4)} sma200=${fmt(ind.sma200, 4)}`,
    `bbUpper=${fmt(ind.bbUpper, 4)} bbLower=${fmt(ind.bbLower, 4)}`,
    `atr14=${fmt(ind.atr14, 4)}`,
    `high52=${fmt(ind.high52, 4)} low52=${fmt(ind.low52, 4)}`,
    `chg24h%=${fmt(ind.changePct24h)}`,
  ].join(", ");
}

const DECISION_SHAPE = `{
  "decision": "BUY" | "SELL" | "HOLD" | "CLOSE",
  "side": "long" | "short",
  "confidence": number (0..1),
  "sentiment": "bullish" | "bearish" | "neutral",
  "rationale": string (2-4 sentences citing the specific indicators),
  "entry": number,
  "stopLoss": number,
  "takeProfit": number,
  "riskReward": number,
  "timeHorizonHours": number
}`;

// Analyze one asset and return a structured trade decision.
export async function analyzeAsset(
  env: Env,
  user: User,
  asset: Asset,
  ind: Indicators,
  recentCloses: number[],
  hasOpenPosition: boolean,
): Promise<{ decision: GeminiDecision; raw: GeminiRawCall }> {
  const model = user.gemini_model || env.GEMINI_MODEL || "gemini-2.5-flash";
  const grounding = (env.ENABLE_SEARCH_GROUNDING || "false") === "true";
  const closesStr = recentCloses.slice(-14).map((c) => roundPrice(c)).join(", ");

  const prompt = `You are an expert systematic trader managing a paper-trading account.
Analyze the asset below and output ONE trading decision as strict JSON.

Asset: ${asset.display_symbol || asset.symbol} (${asset.category}, source=${asset.data_source})
Risk profile: ${user.risk_level} — ${riskGuidance(user.risk_level)}
Account: cash=$${fmt(user.cash_balance)}, min hold time = ${user.min_hold_hours}h, shorting ${
    user.allow_shorting ? "ALLOWED" : "NOT allowed"
  }.
Open position currently: ${hasOpenPosition ? "YES (you may HOLD or CLOSE)" : "NO (you may BUY, SELL/short, or HOLD)"}

Technical snapshot (daily): ${indicatorBlock(ind)}
Recent closes (oldest→newest): ${closesStr}

Rules:
- "BUY" opens/holds a long; "SELL" opens a short (only if shorting allowed) — otherwise use HOLD; "CLOSE" exits an existing position; "HOLD" does nothing.
- entry should be near the current price; stopLoss and takeProfit must be consistent with "side" (long: stop < entry < target; short: target < entry < stop).
- Base stops/targets on ATR and structure. riskReward = |takeProfit-entry| / |entry-stopLoss|.
- If signals are mixed or weak, prefer HOLD with low confidence. Do not invent data.

Respond with ONLY this JSON object (no prose, no markdown):
${DECISION_SHAPE}`;

  const raw = await callGemini(env, model, prompt, { grounding, temperature: 0.35 });
  const parsed = extractJson<any>(raw.text);
  if (!parsed) throw new Error("Gemini decision was not valid JSON.");
  return { decision: normalizeDecision(parsed, ind.price, user.allow_shorting === 1), raw };
}

function normalizeDecision(p: any, price: number, allowShort: boolean): GeminiDecision {
  let decision = String(p.decision ?? "HOLD").toUpperCase() as GeminiDecision;
  if (!["BUY", "SELL", "HOLD", "CLOSE"].includes(decision)) decision = "HOLD";
  let side = String(p.side ?? (decision === "SELL" ? "short" : "long")).toLowerCase() as
    | "long"
    | "short";
  if (side !== "long" && side !== "short") side = "long";
  if (decision === "SELL" && !allowShort) decision = "HOLD";
  const entry = roundPrice(num(p.entry, price) || price);
  const stopLoss = roundPrice(num(p.stopLoss, 0));
  const takeProfit = roundPrice(num(p.takeProfit, 0));
  const rr =
    Math.abs(entry - stopLoss) > 0
      ? Math.abs(takeProfit - entry) / Math.abs(entry - stopLoss)
      : num(p.riskReward, 0);
  return {
    decision,
    side,
    confidence: clamp(num(p.confidence, 0.5), 0, 1),
    sentiment: ["bullish", "bearish", "neutral"].includes(p.sentiment) ? p.sentiment : "neutral",
    rationale: String(p.rationale ?? "").slice(0, 1200),
    entry,
    stopLoss,
    takeProfit,
    riskReward: Number.isFinite(rr) ? Math.round(rr * 100) / 100 : 0,
    timeHorizonHours: clamp(num(p.timeHorizonHours, 24), 1, 24 * 30),
  };
}

export interface DiscoveryResult {
  commentary: string;
  ideas: GeminiDiscovery[];
  raw: GeminiRawCall;
}

// Scan all whitelisted assets and surface the strongest trade ideas ("trend swings").
export async function discoverOpportunities(
  env: Env,
  user: User,
  rows: Array<{ asset: Asset; ind: Indicators }>,
  maxIdeas = 5,
): Promise<DiscoveryResult> {
  const model = env.GEMINI_DISCOVERY_MODEL || env.GEMINI_MODEL || "gemini-2.5-flash";
  const grounding = (env.ENABLE_SEARCH_GROUNDING || "false") === "true";

  const table = rows
    .map(({ asset, ind }) => `- ${asset.symbol} [${asset.category}]: ${indicatorBlock(ind)}`)
    .join("\n");
  const symbolList = rows.map((r) => r.asset.symbol).join(", ");

  const prompt = `You are a market scanner for a paper-trading desk. Review the universe below and
identify the strongest "trend swing" / structural-shift opportunities right now.

Risk profile: ${user.risk_level} — ${riskGuidance(user.risk_level)}
Shorting: ${user.allow_shorting ? "allowed" : "not allowed (long-only ideas)"}

Universe (daily indicators):
${table}

Return strict JSON with:
- "commentary": a 3-5 sentence overview of current cross-market conditions and where the best risk/reward lies.
- "ideas": up to ${maxIdeas} of the BEST setups, each: {
    "symbol": one of [${symbolList}],
    "direction": "long" | "short",
    "strategy": short label (e.g. "RSI reversal", "MACD trend continuation", "52w breakout"),
    "rationale": 1-3 sentences citing specific indicators,
    "indicatorsHit": string[] (e.g. ["RSI<30","price>SMA50"]),
    "riskReward": number,
    "entry": number, "stopLoss": number, "takeProfit": number,
    "confidence": number (0..1)
  }
Only use symbols from the provided universe. Rank ideas by conviction. If nothing is compelling, return fewer ideas.
Respond with ONLY the JSON object.`;

  const raw = await callGemini(env, model, prompt, { grounding, temperature: 0.5, maxTokens: 4096 });
  const parsed = extractJson<any>(raw.text);
  const validSymbols = new Set(rows.map((r) => r.asset.symbol));
  const ideas: GeminiDiscovery[] = Array.isArray(parsed?.ideas)
    ? parsed.ideas
        .filter((i: any) => i && validSymbols.has(i.symbol))
        .slice(0, maxIdeas)
        .map((i: any) => ({
          symbol: i.symbol,
          direction: i.direction === "short" ? "short" : "long",
          strategy: String(i.strategy ?? "").slice(0, 80),
          rationale: String(i.rationale ?? "").slice(0, 800),
          indicatorsHit: Array.isArray(i.indicatorsHit)
            ? i.indicatorsHit.map((x: any) => String(x)).slice(0, 8)
            : [],
          riskReward: num(i.riskReward, 0),
          entry: roundPrice(num(i.entry, 0)),
          stopLoss: roundPrice(num(i.stopLoss, 0)),
          takeProfit: roundPrice(num(i.takeProfit, 0)),
          confidence: clamp(num(i.confidence, 0.5), 0, 1),
        }))
    : [];
  return {
    commentary: String(parsed?.commentary ?? raw.text.slice(0, 800)),
    ideas,
    raw,
  };
}
