-- Owner channels are snapshotted in existing recipient_json. Old delivered
-- cards retain the channel from their saved permalink; keep the configured
-- fallback channel for older uncertain sends that have no permalink yet.
ALTER TABLE proposals ADD COLUMN reviewer_json TEXT;
ALTER TABLE proposals ADD COLUMN reviewer_delivery TEXT NOT NULL DEFAULT 'not_sent' CHECK(reviewer_delivery IN ('not_sent', 'sending', 'sent', 'failed', 'uncertain'));
ALTER TABLE proposals ADD COLUMN reviewer_slack_url TEXT;
ALTER TABLE notifications ADD COLUMN reviewer_json TEXT;
ALTER TABLE notifications ADD COLUMN reviewer_delivery TEXT NOT NULL DEFAULT 'not_sent' CHECK(reviewer_delivery IN ('not_sent', 'sending', 'sent', 'failed', 'uncertain'));
ALTER TABLE notifications ADD COLUMN reviewer_slack_url TEXT;
