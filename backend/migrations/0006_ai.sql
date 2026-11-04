-- Durable lifetime reservations: never reset or delete these rows to regain budget.
-- A single conditional INSERT reserves against all prior calls atomically.
CREATE TABLE IF NOT EXISTS ai_jobs (
  request_id TEXT PRIMARY KEY,
  actor_hash TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('review', 'edit')),
  model TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  reserved_cents INTEGER NOT NULL CHECK(reserved_cents > 0),
  created_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('running', 'completed', 'failed')),
  result_json TEXT,
  error_code TEXT
);
CREATE INDEX IF NOT EXISTS ai_jobs_actor_time ON ai_jobs(actor_hash, kind, created_at);
CREATE INDEX IF NOT EXISTS ai_jobs_running ON ai_jobs(state, created_at);
