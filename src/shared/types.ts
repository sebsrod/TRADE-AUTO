// Shared types — the API contract between the Cloudflare Worker and the React client.

export type AssetCategory = "stock" | "etf" | "future" | "option" | "crypto";
export type RiskLevel = "low" | "medium" | "high";
// Chart / analysis granularities. Binance serves all of these natively; for Yahoo
// the non-native ones (4h, 8h, 3d) are aggregated from a finer base interval.
export type Timeframe = "15m" | "30m" | "1h" | "4h" | "8h" | "1d" | "3d" | "1w" | "1M";
// Every supported timeframe, oldest→finest order, for selectors and validation.
export const TIMEFRAMES: Timeframe[] = ["15m", "30m", "1h", "4h", "8h", "1d", "3d", "1w", "1M"];
export type TradeSide = "long" | "short";
export type TradeStatus = "open" | "closed";
export type AIDecision = "BUY" | "SELL" | "HOLD" | "CLOSE";
export type Sentiment = "bullish" | "bearish" | "neutral";
export type SuggestionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executed"
  | "expired";

export interface User {
  id: number;
  name: string;
  email: string | null;
  starting_balance: number;
  cash_balance: number;
  risk_level: RiskLevel;
  min_hold_hours: number;
  max_trades_per_day: number;
  max_open_positions: number;
  auto_trade_enabled: number; // 0 | 1
  allow_shorting: number; // 0 | 1
  ai_model: string | null; // optional per-user Claude model override
  analysis_timeframe: Timeframe;
  strategy_notes: string | null; // user's free-text style/instructions for the AI
  created_at: string;
  updated_at: string;
}

export interface Asset {
  id: number;
  symbol: string;
  display_symbol: string | null;
  name: string | null;
  category: AssetCategory;
  data_source: string;
  quote_currency: string;
  whitelisted: number; // 0 | 1
  active: number; // 0 | 1
  created_at: string;
}

export interface Candle {
  t: number; // epoch ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface Indicators {
  price: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema12: number | null;
  ema26: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  bbUpper: number | null;
  bbLower: number | null;
  bbMid: number | null;
  atr14: number | null;
  high52: number | null;
  low52: number | null;
  changePct24h: number | null;
  trend: "up" | "down" | "sideways";
}

export interface Trade {
  id: number;
  user_id: number;
  asset_id: number;
  symbol: string;
  category: AssetCategory;
  side: TradeSide;
  status: TradeStatus;
  quantity: number;
  entry_price: number;
  entry_time: string;
  exit_price: number | null;
  exit_time: string | null;
  stop_loss: number | null;
  take_profit: number | null;
  position_value: number;
  risk_amount: number | null;
  pnl: number | null;
  pnl_pct: number | null;
  fees: number;
  exit_reason: string | null;
  ai_rationale: string | null; // why the position was opened
  exit_rationale: string | null; // the AI's reasoning when it closed the position
  ai_log_id: number | null;
  confidence: number | null;
  created_at: string;
  updated_at: string;
}

// An open trade enriched with live market price + unrealized PnL.
export interface OpenPosition extends Trade {
  current_price: number | null;
  unrealized_pnl: number | null;
  unrealized_pnl_pct: number | null;
  market_value: number | null;
  hold_hours: number;
  can_close: boolean; // min-hold guardrail satisfied
}

export interface AILog {
  id: number;
  user_id: number | null;
  asset_id: number | null;
  symbol: string | null;
  model: string;
  kind: "decision" | "discovery" | "commentary";
  decision: AIDecision | null;
  confidence: number | null;
  sentiment: Sentiment | null;
  rationale: string | null;
  stop_loss: number | null;
  take_profit: number | null;
  risk_reward: number | null;
  indicators_json: string | null;
  prompt: string | null;
  raw_response: string | null;
  grounded: number;
  created_at: string;
}

export interface Suggestion {
  id: number;
  user_id: number;
  asset_id: number | null;
  symbol: string;
  category: AssetCategory | null;
  direction: TradeSide | null;
  strategy: string | null;
  rationale: string | null;
  indicators_hit: string | null; // JSON list
  risk_reward: number | null;
  entry: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  confidence: number | null;
  status: SuggestionStatus;
  ai_log_id: number | null;
  created_at: string;
}

export interface EquityPoint {
  id: number;
  user_id: number;
  equity: number;
  cash: number;
  open_positions: number;
  realized_pnl: number;
  unrealized_pnl: number;
  recorded_at: string;
}

export interface PerformanceMetrics {
  startingBalance: number;
  cash: number;
  equity: number; // cash + open market value
  unrealizedPnl: number;
  realizedPnl: number;
  totalPnl: number;
  roiPct: number;
  openPositions: number;
  totalTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number; // 0..1
  avgWin: number;
  avgLoss: number;
  profitFactor: number | null;
  expectancy: number;
  sharpe: number | null; // annualized, from equity returns
  maxDrawdownPct: number;
  bestTradePnl: number;
  worstTradePnl: number;
}

export interface PortfolioResponse {
  user: User;
  metrics: PerformanceMetrics;
  positions: OpenPosition[];
}

// Lightweight payload for the fast (~5s) live-P&L poll: positions repriced at the
// latest spot quote + freshly recomputed metrics. No user/closed-trade churn.
export interface LivePortfolio {
  positions: OpenPosition[];
  metrics: PerformanceMetrics;
  asOf: string;
}

// The authenticated account as returned by the auth endpoints (no secrets).
export interface AuthResponse {
  user: User;
}

// The structured decision the AI returns for a single asset.
export interface TradeDecision {
  decision: AIDecision;
  side: TradeSide;
  confidence: number; // 0..1
  sentiment: Sentiment;
  rationale: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  timeHorizonHours: number;
}

// One discovered trade idea from the discovery scan.
export interface TradeIdea {
  symbol: string;
  direction: TradeSide;
  strategy: string;
  rationale: string;
  indicatorsHit: string[];
  riskReward: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
}

export interface OptionContract {
  contractSymbol: string; // OCC symbol, e.g. AAPL240119C00150000
  type: "call" | "put";
  strike: number;
  lastPrice: number;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
  inTheMoney: boolean;
  expiration: number; // epoch ms
}

export interface OptionChain {
  underlying: string;
  underlyingPrice: number | null;
  expirations: number[]; // epoch ms
  expiration: number | null; // the one returned
  calls: OptionContract[];
  puts: OptionContract[];
}

// One turn in the user ⇆ Claude conversation (persisted per user).
export interface ChatMessage {
  id: number;
  user_id: number;
  role: "user" | "assistant";
  content: string;
  asset_symbol: string | null;
  model: string | null;
  created_at: string;
}

// Reply to a chat turn. `strategyUpdate`, when present, is a full revised
// trading-style note the user can one-click apply to their strategy.
export interface ChatResponse {
  reply: ChatMessage;
  strategyUpdate: string | null;
  contextSymbols: string[]; // assets the model was given live context for
}

export interface ApiError {
  error: string;
  detail?: string;
}
