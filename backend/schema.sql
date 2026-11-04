CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_sent_at INTEGER NOT NULL DEFAULT 0,
  send_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL REFERENCES sessions(token_hash),
  request_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'changes_requested', 'superseded')),
  delivery TEXT NOT NULL DEFAULT 'sending' CHECK(delivery IN ('sending', 'sent', 'failed', 'uncertain')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  slack_ts TEXT,
  slack_url TEXT,
  feedback TEXT,
  decided_at TEXT,
  decided_by TEXT,
  asset_image TEXT,
  preview_token TEXT,
  recipient_json TEXT,
  reviewer_json TEXT,
  reviewer_delivery TEXT NOT NULL DEFAULT 'not_sent' CHECK(reviewer_delivery IN ('not_sent', 'sending', 'sent', 'failed', 'uncertain')),
  reviewer_slack_url TEXT,
  UNIQUE(session_hash, request_id)
);

CREATE INDEX IF NOT EXISTS proposals_session ON proposals(session_hash);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL REFERENCES sessions(token_hash),
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('approved', 'revision_requested')),
  status TEXT NOT NULL CHECK(status IN ('noted', 'awaiting_acknowledgment', 'acknowledged')),
  delivery TEXT NOT NULL DEFAULT 'sending' CHECK(delivery IN ('sending', 'sent', 'failed', 'uncertain')),
  payload_json TEXT NOT NULL,
  recipient_json TEXT NOT NULL,
  reviewer_json TEXT,
  reviewer_delivery TEXT NOT NULL DEFAULT 'not_sent' CHECK(reviewer_delivery IN ('not_sent', 'sending', 'sent', 'failed', 'uncertain')),
  reviewer_slack_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  slack_ts TEXT,
  slack_url TEXT,
  asset_image TEXT,
  preview_token TEXT,
  acknowledged_at TEXT,
  acknowledged_by TEXT,
  UNIQUE(session_hash, request_id)
);
CREATE INDEX IF NOT EXISTS notifications_session ON notifications(session_hash);
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
  error_code TEXT,
  provider_usage_json TEXT,
  estimated_cost_usd REAL CHECK(estimated_cost_usd >= 0),
  usage_recorded_at INTEGER,
  pricing_version TEXT
);
CREATE INDEX IF NOT EXISTS ai_jobs_actor_time ON ai_jobs(actor_hash, kind, created_at);
CREATE INDEX IF NOT EXISTS ai_jobs_running ON ai_jobs(state, created_at);
