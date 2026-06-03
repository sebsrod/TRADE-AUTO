-- Seed the default single-user profile and a starter multi-asset watchlist.

INSERT INTO users (id, name, starting_balance, cash_balance)
VALUES (1, 'Default Trader', 100000, 100000)
ON CONFLICT(id) DO NOTHING;

INSERT INTO assets (symbol, display_symbol, name, category, data_source) VALUES
  ('AAPL',    'AAPL',    'Apple Inc.',              'stock',  'yahoo'),
  ('MSFT',    'MSFT',    'Microsoft Corp.',         'stock',  'yahoo'),
  ('NVDA',    'NVDA',    'NVIDIA Corp.',            'stock',  'yahoo'),
  ('TSLA',    'TSLA',    'Tesla Inc.',              'stock',  'yahoo'),
  ('SPY',     'SPY',     'SPDR S&P 500 ETF',        'etf',    'yahoo'),
  ('QQQ',     'QQQ',     'Invesco QQQ Trust',       'etf',    'yahoo'),
  ('ES=F',    'ES',      'E-mini S&P 500 Futures',  'future', 'yahoo'),
  ('NQ=F',    'NQ',      'E-mini Nasdaq Futures',   'future', 'yahoo'),
  ('GC=F',    'GC',      'Gold Futures',            'future', 'yahoo'),
  ('BTCUSDT', 'BTC/USDT','Bitcoin',                 'crypto', 'binance'),
  ('ETHUSDT', 'ETH/USDT','Ethereum',                'crypto', 'binance'),
  ('SOLUSDT', 'SOL/USDT','Solana',                  'crypto', 'binance')
ON CONFLICT(symbol, category) DO NOTHING;
