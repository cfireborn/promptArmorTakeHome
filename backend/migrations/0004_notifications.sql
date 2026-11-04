ALTER TABLE proposals ADD COLUMN recipient_json TEXT;

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL REFERENCES sessions(token_hash),
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('approved', 'revision_requested')),
  status TEXT NOT NULL CHECK(status IN ('noted', 'awaiting_acknowledgment', 'acknowledged')),
  delivery TEXT NOT NULL DEFAULT 'sending' CHECK(delivery IN ('sending', 'sent', 'failed', 'uncertain')),
  payload_json TEXT NOT NULL,
  recipient_json TEXT NOT NULL,
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
