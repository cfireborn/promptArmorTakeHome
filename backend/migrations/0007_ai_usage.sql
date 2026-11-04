-- Received provider metrics and list-price estimates only; never backfill
-- historical calls with invented spend or reduce conservative reservations.
ALTER TABLE ai_jobs ADD COLUMN provider_usage_json TEXT;
ALTER TABLE ai_jobs ADD COLUMN estimated_cost_usd REAL CHECK(estimated_cost_usd >= 0);
ALTER TABLE ai_jobs ADD COLUMN usage_recorded_at INTEGER;
ALTER TABLE ai_jobs ADD COLUMN pricing_version TEXT;
