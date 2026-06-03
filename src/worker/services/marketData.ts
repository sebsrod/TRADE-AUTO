// Market-data ingestion. Keyless-first (Binance for crypto, Yahoo Finance v8 for
// everything else), with optional keyed fallbacks (Finnhub). All calls are
// timeout-guarded so a hanging upstream can never blow the Worker wall-clock budget.

import type { Asset, Candle } from "../../shared/types";
import type { Env } from "../types";
import { num, withTimeout } from "../util";

const FETCH_TIMEOUT_MS = 9000;
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface MarketData {
  symbol: string;
  candles: Candle[];
  price: number;
  source: string;
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<any> {
  const res = await withTimeout(
    fetch(url, { headers: { "User-Agent": BROWSER_UA, Accept: "application/json", ...headers } }),
    FETCH_TIMEOUT_MS,
    `fetch ${new URL(url).host}`,
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Binance — keyless crypto klines (very generous rate limits).
// ---------------------------------------------------------------------------
async function fetchBinance(symbol: string): Promise<MarketData> {
  // Try the primary host then a mirror.
  const hosts = ["https://api.binance.com", "https://data-api.binance.vision"];
  let lastErr: unknown;
  for (const host of hosts) {
    try {
      const url = `${host}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=1d&limit=365`;
      const rows = (await fetchJson(url)) as any[];
      const candles: Candle[] = rows.map((r) => ({
        t: num(r[0]),
        o: num(r[1]),
        h: num(r[2]),
        l: num(r[3]),
        c: num(r[4]),
        v: num(r[5]),
      }));
      const price = candles.length ? candles[candles.length - 1].c : 0;
      return { symbol, candles, price, source: "binance" };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("binance fetch failed");
}

// ---------------------------------------------------------------------------
// Yahoo Finance v8 chart — keyless; covers stocks, ETFs, futures, options.
// ---------------------------------------------------------------------------
async function fetchYahoo(symbol: string): Promise<MarketData> {
  const hosts = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
  let lastErr: unknown;
  for (const host of hosts) {
    try {
      const url =
        `${host}/v8/finance/chart/${encodeURIComponent(symbol)}` +
        `?interval=1d&range=1y&includePrePost=false`;
      const data = await fetchJson(url);
      const result = data?.chart?.result?.[0];
      if (!result) throw new Error("yahoo: empty result");
      const ts: number[] = result.timestamp ?? [];
      const q = result.indicators?.quote?.[0] ?? {};
      const candles: Candle[] = [];
      for (let i = 0; i < ts.length; i++) {
        const c = q.close?.[i];
        if (c == null) continue; // Yahoo emits null gaps
        candles.push({
          t: ts[i] * 1000,
          o: num(q.open?.[i], c),
          h: num(q.high?.[i], c),
          l: num(q.low?.[i], c),
          c: num(c),
          v: num(q.volume?.[i], 0),
        });
      }
      const meta = result.meta ?? {};
      const price = num(meta.regularMarketPrice, candles.at(-1)?.c ?? 0);
      if (!candles.length) throw new Error("yahoo: no candles");
      return { symbol, candles, price, source: "yahoo" };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("yahoo fetch failed");
}

// ---------------------------------------------------------------------------
// Finnhub — keyed fallback covering stocks/forex/crypto.
// ---------------------------------------------------------------------------
async function fetchFinnhub(symbol: string, env: Env, crypto: boolean): Promise<MarketData> {
  const key = env.FINNHUB_API_KEY;
  if (!key) throw new Error("finnhub: no API key");
  const to = Math.floor(Date.now() / 1000);
  const from = to - 400 * 24 * 3600;
  const path = crypto ? "crypto/candle" : "stock/candle";
  const sym = crypto ? `BINANCE:${symbol}` : symbol;
  const url =
    `https://finnhub.io/api/v1/${path}?symbol=${encodeURIComponent(sym)}` +
    `&resolution=D&from=${from}&to=${to}&token=${key}`;
  const data = await fetchJson(url);
  if (data?.s !== "ok" || !Array.isArray(data?.t)) throw new Error("finnhub: no data");
  const candles: Candle[] = data.t.map((t: number, i: number) => ({
    t: t * 1000,
    o: num(data.o[i]),
    h: num(data.h[i]),
    l: num(data.l[i]),
    c: num(data.c[i]),
    v: num(data.v?.[i], 0),
  }));
  const price = candles.length ? candles[candles.length - 1].c : 0;
  return { symbol, candles, price, source: "finnhub" };
}

// ---------------------------------------------------------------------------
// Public entry point: route by data_source / category with graceful fallback.
// ---------------------------------------------------------------------------
export async function fetchMarketData(asset: Asset, env: Env): Promise<MarketData> {
  const isCrypto = asset.category === "crypto";
  const source = (asset.data_source || (isCrypto ? "binance" : "yahoo")).toLowerCase();

  const attempts: Array<() => Promise<MarketData>> = [];
  if (source === "binance" || isCrypto) attempts.push(() => fetchBinance(asset.symbol));
  if (source === "yahoo" || (!isCrypto && source !== "finnhub")) {
    attempts.push(() => fetchYahoo(asset.symbol));
  }
  // Finnhub as last-resort fallback when a key is present.
  if (env.FINNHUB_API_KEY) attempts.push(() => fetchFinnhub(asset.symbol, env, isCrypto));
  // Ensure crypto can still fall back to Yahoo (e.g. BTC-USD) if Binance is blocked.
  if (isCrypto) attempts.push(() => fetchYahoo(asset.symbol.replace("USDT", "-USD")));

  let lastErr: unknown;
  for (const attempt of attempts) {
    try {
      const data = await attempt();
      if (data.candles.length >= 2) return data;
      lastErr = new Error("insufficient candles");
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    `Failed to fetch market data for ${asset.symbol}: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}
