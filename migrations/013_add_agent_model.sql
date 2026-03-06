ALTER TABLE agents ADD COLUMN IF NOT EXISTS model VARCHAR(100) DEFAULT 'openrouter-claude-3-5-sonnet';
