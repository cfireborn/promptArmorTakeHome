CREATE TABLE proposals_next (
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
  UNIQUE(session_hash, request_id)
);


INSERT INTO proposals_next SELECT * FROM proposals;
DROP TABLE proposals;
ALTER TABLE proposals_next RENAME TO proposals;
CREATE INDEX proposals_session ON proposals(session_hash);
