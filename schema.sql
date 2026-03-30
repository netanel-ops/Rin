-- Nati Don't Shout - Database Schema

CREATE TABLE IF NOT EXISTS markets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  options TEXT NOT NULL, -- JSON array
  probabilities TEXT NOT NULL, -- JSON array [49,50,1]
  allocation REAL NOT NULL, -- USD amount
  status TEXT DEFAULT 'planned', -- planned|approved|queued|executing|executed|failed
  interval_minutes INTEGER, -- fire time in minutes from generation
  fire_at INTEGER, -- unix timestamp
  market_length_days INTEGER DEFAULT 14,
  expiration_timestamp INTEGER, -- actual expiration with jitter
  tx_hash TEXT,
  market_address TEXT,
  error_message TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  executed_at INTEGER,
  wallet_address TEXT
);

CREATE TABLE IF NOT EXISTS generation_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  num_markets INTEGER NOT NULL,
  total_allocation REAL NOT NULL,
  size_deviation_pct REAL DEFAULT 20,
  base_interval_minutes INTEGER DEFAULT 60,
  market_length_days INTEGER DEFAULT 14,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS wallet_pool (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT UNIQUE NOT NULL,
  private_key TEXT NOT NULL,
  label TEXT,
  active INTEGER DEFAULT 1,
  last_used_at INTEGER
);

CREATE TABLE IF NOT EXISTS execution_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id INTEGER,
  event TEXT NOT NULL, -- batch_start|market_create|market_success|market_fail|batch_complete
  message TEXT,
  tx_hash TEXT,
  error TEXT,
  timestamp INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (market_id) REFERENCES markets(id)
);

CREATE INDEX IF NOT EXISTS idx_markets_status ON markets(status);
CREATE INDEX IF NOT EXISTS idx_markets_fire_at ON markets(fire_at);
CREATE INDEX IF NOT EXISTS idx_execution_log_market ON execution_log(market_id);
