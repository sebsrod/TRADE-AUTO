// Market-data ingestion. Keyless-first (Binance for crypto, Yahoo Finance v8 for
// everything else), with optional keyed fallbacks (Finnhub). Supports intraday and
// daily intervals plus option-chain lookups. All calls are timeout-guarded so a
// hanging upstream can never blow the Worker wall-clock budget.

import type { Asset, Candle, OptionChain, OptionContract, Timeframe } from "../../shared/types";
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
  interval: Timeframe;
}

export function normalizeInterval(tf?: string): Timeframe {
  return tf === "1h" || tf === "4h" || tf === "1d" ? tf : "1d";
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<any> {
  const res = await withTimeout(
    (signal) =>
      fetch(url, {
        headers: { "User-Agent": BROWSER_UA, Accept: "application/json", ...headers },
        signal,
      }),
    FETCH_TIMEOUT_MS,
    `fetch ${new URL(url).host}`,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Binance — keyless crypto klines. Native 1h / 4h / 1d.
// ---------------------------------------------------------------------------
async function fetchBinance(symbol: string, interval: Timeframe): Promise<MarketData> {
  const limit = interval === "1d" ? 365 : interval === "4h" ? 500 : 720;
  const hosts = ["https://api.binance.com", "https://data-api.binance.vision"];
  let lastErr: unknown;
  for (const host of hosts) {
    try {
      const url = `${host}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
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
      return { symbol, candles, price, source: "binance", interval };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("binance fetch failed");
}

// ---------------------------------------------------------------------------
// Yahoo Finance v8 chart — keyless; stocks, ETFs, futures, options (OCC symbols).
// Native 1h / 1d; 4h is not offered by Yahoo, so it falls back to 1h.
// ---------------------------------------------------------------------------
function yahooParams(interval: Timeframe): { interval: string; range: string } {
  if (interval === "1d") return { interval: "1d", range: "1y" };
  // 1h (and 4h-as-1h): Yahoo caps 1h history at ~730d; 6mo gives ample bars.
  return { interval: "1h", range: "6mo" };
}

async function fetchYahoo(symbol: string, interval: Timeframe): Promise<MarketData> {
  const { interval: yInt, range } = yahooParams(interval);
  const hosts = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
  let lastErr: unknown;
  for (const host of hosts) {
    try {
      const url =
        `${host}/v8/finance/chart/${encodeURIComponent(symbol)}` +
        `?interval=${yInt}&range=${range}&includePrePost=false`;
      const data = await fetchJson(url);
      const result = data?.chart?.result?.[0];
      if (!result) throw new Error("yahoo: empty result");
      const ts: number[] = result.timestamp ?? [];
      const q = result.indicators?.quote?.[0] ?? {};
      const candles: Candle[] = [];
      for (let i = 0; i < ts.length; i++) {
        const c = q.close?.[i];
        if (c == null) continue;
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
      // Report the granularity actually served (Yahoo has no 4h → it's 1h bars).
      return { symbol, candles, price, source: "yahoo", interval: interval === "1d" ? "1d" : "1h" };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("yahoo fetch failed");
}

// ---------------------------------------------------------------------------
// Finnhub — keyed fallback covering stocks/forex/crypto.
// ---------------------------------------------------------------------------
async function fetchFinnhub(symbol: string, interval: Timeframe, env: Env, crypto: boolean): Promise<MarketData> {
  const key = env.FINNHUB_API_KEY;
  if (!key) throw new Error("finnhub: no API key");
  const resolution = interval === "1d" ? "D" : "60"; // Finnhub has no 4h
  const to = Math.floor(Date.now() / 1000);
  const windowSecs = interval === "1d" ? 400 * 24 * 3600 : 60 * 24 * 3600;
  const from = to - windowSecs;
  const path = crypto ? "crypto/candle" : "stock/candle";
  const sym = crypto ? `BINANCE:${symbol}` : symbol;
  const url =
    `https://finnhub.io/api/v1/${path}?symbol=${encodeURIComponent(sym)}` +
    `&resolution=${resolution}&from=${from}&to=${to}&token=${key}`;
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
  // Finnhub has no 4h resolution → it served 1h bars.
  return { symbol, candles, price, source: "finnhub", interval: interval === "1d" ? "1d" : "1h" };
}

// ---------------------------------------------------------------------------
// Public entry point: route by data_source / category with graceful fallback.
// ---------------------------------------------------------------------------
export async function fetchMarketData(
  asset: Asset,
  env: Env,
  interval: Timeframe = "1d",
): Promise<MarketData> {
  const isCrypto = asset.category === "crypto";
  const source = (asset.data_source || (isCrypto ? "binance" : "yahoo")).toLowerCase();

  const attempts: Array<() => Promise<MarketData>> = [];
  if (source === "binance" || isCrypto) attempts.push(() => fetchBinance(asset.symbol, interval));
  if (source === "yahoo" || (!isCrypto && source !== "finnhub")) {
    attempts.push(() => fetchYahoo(asset.symbol, interval));
  }
  if (env.FINNHUB_API_KEY) attempts.push(() => fetchFinnhub(asset.symbol, interval, env, isCrypto));
  if (isCrypto) attempts.push(() => fetchYahoo(asset.symbol.replace("USDT", "-USD"), interval));

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

// ---------------------------------------------------------------------------
// Option chains. Primary: CBOE delayed quotes (keyless, all expiries in one call).
// Fallback: Yahoo v7 (now often needs a crumb, so used only if CBOE fails).
// ---------------------------------------------------------------------------

// Parse an OCC option symbol (e.g. AAPL260619C00200000) from the right so it works
// regardless of root length: [root][YYMMDD][C|P][strike*1000, 8 digits].
function parseOcc(occ: string): { type: "call" | "put"; strike: number; expiration: number } | null {
  if (!occ || occ.length < 15) return null;
  const strike = parseInt(occ.slice(-8), 10) / 1000;
  const t = occ.slice(-9, -8).toUpperCase();
  const yy = parseInt(occ.slice(-15, -13), 10);
  const mm = parseInt(occ.slice(-13, -11), 10);
  const dd = parseInt(occ.slice(-11, -9), 10);
  if (![strike, yy, mm, dd].every(Number.isFinite) || (t !== "C" && t !== "P")) return null;
  return { type: t === "P" ? "put" : "call", strike, expiration: Date.UTC(2000 + yy, mm - 1, dd) };
}

const oneDayMs = 24 * 3600 * 1000;

async function fetchOptionChainCBOE(underlying: string, expirationMs?: number): Promise<OptionChain> {
  const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(underlying)}.json`;
  const data = await fetchJson(url);
  const d = data?.data;
  if (!d || !Array.isArray(d.options)) throw new Error("cboe: no options");
  const underlyingPrice = d.current_price != null ? num(d.current_price) : null;

  const parsed = (d.options as any[])
    .map((o) => {
      const p = parseOcc(String(o.option ?? ""));
      return p ? { o, p } : null;
    })
    .filter((x): x is { o: any; p: NonNullable<ReturnType<typeof parseOcc>> } => x != null);

  const expirations = Array.from(new Set(parsed.map((x) => x.p.expiration))).sort((a, b) => a - b);
  let chosen: number | null = expirations[0] ?? null;
  if (expirationMs) {
    chosen = expirations.find((e) => Math.abs(e - expirationMs) < oneDayMs) ?? chosen;
  } else {
    const cutoff = Date.now() - oneDayMs;
    chosen = expirations.find((e) => e >= cutoff) ?? chosen;
  }

  const toContract = (x: { o: any; p: NonNullable<ReturnType<typeof parseOcc>> }): OptionContract => ({
    contractSymbol: String(x.o.option),
    type: x.p.type,
    strike: x.p.strike,
    lastPrice: num(x.o.last_trade_price ?? x.o.theo),
    bid: x.o.bid != null ? num(x.o.bid) : null,
    ask: x.o.ask != null ? num(x.o.ask) : null,
    volume: x.o.volume != null ? num(x.o.volume) : null,
    openInterest: x.o.open_interest != null ? num(x.o.open_interest) : null,
    impliedVolatility: x.o.iv != null ? num(x.o.iv) : null,
    inTheMoney:
      underlyingPrice != null &&
      (x.p.type === "call" ? x.p.strike < underlyingPrice : x.p.strike > underlyingPrice),
    expiration: x.p.expiration,
  });

  const forExp = parsed.filter((x) => chosen != null && x.p.expiration === chosen);
  const calls = forExp.filter((x) => x.p.type === "call").map(toContract).sort((a, b) => a.strike - b.strike);
  const puts = forExp.filter((x) => x.p.type === "put").map(toContract).sort((a, b) => a.strike - b.strike);

  return {
    underlying: String(d.symbol ?? underlying),
    underlyingPrice,
    expirations,
    expiration: chosen,
    calls,
    puts,
  };
}

function mapYahooContract(o: any, type: "call" | "put"): OptionContract {
  return {
    contractSymbol: String(o.contractSymbol ?? ""),
    type,
    strike: num(o.strike),
    lastPrice: num(o.lastPrice),
    bid: o.bid != null ? num(o.bid) : null,
    ask: o.ask != null ? num(o.ask) : null,
    volume: o.volume != null ? num(o.volume) : null,
    openInterest: o.openInterest != null ? num(o.openInterest) : null,
    impliedVolatility: o.impliedVolatility != null ? num(o.impliedVolatility) : null,
    inTheMoney: !!o.inTheMoney,
    expiration: num(o.expiration) * 1000,
  };
}

async function fetchOptionChainYahoo(underlying: string, expirationMs?: number): Promise<OptionChain> {
  const hosts = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
  const dateParam = expirationMs ? `?date=${Math.floor(expirationMs / 1000)}` : "";
  let lastErr: unknown;
  for (const host of hosts) {
    try {
      const url = `${host}/v7/finance/options/${encodeURIComponent(underlying)}${dateParam}`;
      const data = await fetchJson(url);
      const result = data?.optionChain?.result?.[0];
      if (!result) throw new Error("no option chain");
      const opt = result.options?.[0] ?? {};
      return {
        underlying: String(result.underlyingSymbol ?? underlying),
        underlyingPrice:
          result.quote?.regularMarketPrice != null ? num(result.quote.regularMarketPrice) : null,
        expirations: (result.expirationDates ?? []).map((s: number) => num(s) * 1000),
        expiration: opt.expirationDate != null ? num(opt.expirationDate) * 1000 : null,
        calls: (opt.calls ?? []).map((o: any) => mapYahooContract(o, "call")),
        puts: (opt.puts ?? []).map((o: any) => mapYahooContract(o, "put")),
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("yahoo options failed");
}

export async function fetchOptionChain(
  underlying: string,
  _env: Env,
  expirationMs?: number,
): Promise<OptionChain> {
  try {
    return await fetchOptionChainCBOE(underlying, expirationMs);
  } catch (e1) {
    try {
      return await fetchOptionChainYahoo(underlying, expirationMs);
    } catch (e2) {
      const m = (e: unknown) => (e instanceof Error ? e.message : String(e));
      throw new Error(`Failed to fetch option chain for ${underlying}: cboe(${m(e1)}); yahoo(${m(e2)})`);
    }
  }
}
