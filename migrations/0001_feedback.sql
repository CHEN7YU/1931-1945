CREATE TABLE feedback (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('bug', 'suggestion', 'other')),
  content TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  build TEXT NOT NULL,
  map TEXT NOT NULL,
  game_state TEXT NOT NULL,
  browser TEXT NOT NULL,
  viewport TEXT NOT NULL,
  created_at TEXT NOT NULL,
  fingerprint TEXT NOT NULL
);

CREATE TABLE feedback_limits (
  client_hash TEXT PRIMARY KEY,
  last_sent INTEGER NOT NULL,
  hour INTEGER NOT NULL,
  count INTEGER NOT NULL
);
CREATE INDEX feedback_limits_expiry ON feedback_limits(last_sent);
