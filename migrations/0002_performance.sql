CREATE TABLE performance_batches (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  build TEXT NOT NULL,
  map TEXT NOT NULL,
  created_at TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX performance_created ON performance_batches(created_at);
CREATE INDEX performance_build_map ON performance_batches(build, map, created_at);
CREATE INDEX performance_session ON performance_batches(session_id, created_at);
CREATE TABLE performance_limits (
  client_hash TEXT PRIMARY KEY,
  minute INTEGER NOT NULL,
  count INTEGER NOT NULL
);
