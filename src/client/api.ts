// Typed client for the Worker API.

import type {
  AILog,
  Asset,
  Candle,
  EquityPoint,
  GeminiDiscovery,
  Indicators,
  OptionChain,
  PortfolioResponse,
  Suggestion,
  Timeframe,
  Trade,
  User,
} from "../shared/types";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail = data?.detail ? ` — ${data.detail}` : "";
    throw new Error((data?.error || `HTTP ${res.status}`) + detail);
  }
  return data as T;
}

export interface HealthResponse {
  ok: boolean;
  service: string;
  geminiConfigured: boolean;
  model: string;
  time: string;
}

export interface MarketResponse {
  asset: Asset;
  price: number;
  source: string;
  cached: boolean;
  interval: Timeframe;
  indicators: Indicators;
  candles: Candle[];
}

export interface DiscoverResponse {
  commentary: string;
  ideas: GeminiDiscovery[];
  suggestionsCreated: number;
  suggestions: Suggestion[];
}

export const api = {
  health: () => req<HealthResponse>("/health"),

  // config
  getConfig: () => req<User>("/config"),
  updateConfig: (patch: Partial<User> & Record<string, unknown>) =>
    req<User>("/config", { method: "PATCH", body: JSON.stringify(patch) }),
  resetAccount: () => req<{ ok: boolean; user: User }>("/config/reset", { method: "POST" }),

  // assets
  getAssets: () => req<Asset[]>("/assets"),
  addAsset: (a: { symbol: string; category: string; name?: string; data_source?: string }) =>
    req<Asset>("/assets", { method: "POST", body: JSON.stringify(a) }),
  updateAsset: (id: number, patch: Partial<Asset> & Record<string, unknown>) =>
    req<Asset>(`/assets/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteAsset: (id: number) => req<{ ok: boolean }>(`/assets/${id}`, { method: "DELETE" }),

  // market
  market: (assetId: number, interval?: Timeframe) =>
    req<MarketResponse>(`/market/${assetId}${interval ? `?interval=${interval}` : ""}`),

  // options
  optionChain: (symbol: string, expiration?: number) =>
    req<OptionChain>(`/options/${symbol}${expiration ? `?expiration=${expiration}` : ""}`),
  trackOption: (contractSymbol: string, name?: string) =>
    req<Asset>("/options/track", {
      method: "POST",
      body: JSON.stringify({ contractSymbol, name }),
    }),

  // portfolio / metrics
  portfolio: () => req<PortfolioResponse>("/portfolio"),
  equity: () => req<EquityPoint[]>("/portfolio/equity"),

  // trades
  trades: (status?: "open" | "closed") =>
    req<Trade[]>(`/trades${status ? `?status=${status}` : ""}`),
  openTrade: (body: {
    assetId: number;
    side?: "long" | "short";
    entry?: number;
    stopLoss?: number;
    takeProfit?: number;
  }) => req<Trade>("/trades", { method: "POST", body: JSON.stringify(body) }),
  closeTrade: (id: number) => req<Trade>(`/trades/${id}/close`, { method: "POST", body: "{}" }),

  // ai
  aiLogs: (limit = 30) => req<AILog[]>(`/ai/logs?limit=${limit}`),
  suggestions: (status?: string) =>
    req<Suggestion[]>(`/ai/suggestions${status ? `?status=${status}` : ""}`),
  discover: () => req<DiscoverResponse>("/ai/discover", { method: "POST", body: "{}" }),
  runCycle: () =>
    req<{ closedByStops: number; suggestions: number; autoOpened: number; errors: string[] }>(
      "/ai/run-cycle",
      { method: "POST", body: "{}" },
    ),
  analyze: (assetId: number, execute = false) =>
    req<{ symbol: string; decision: string; action: string; confidence: number }>(
      `/ai/analyze/${assetId}`,
      { method: "POST", body: JSON.stringify({ execute }) },
    ),
  approveSuggestion: (id: number) =>
    req<{ ok: boolean; trade: Trade }>(`/ai/suggestions/${id}/approve`, {
      method: "POST",
      body: "{}",
    }),
  rejectSuggestion: (id: number) =>
    req<{ ok: boolean }>(`/ai/suggestions/${id}/reject`, { method: "POST", body: "{}" }),
};
