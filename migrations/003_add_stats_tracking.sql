-- Add agent_id and response_time_ms to token_usage
ALTER TABLE token_usage 
ADD COLUMN IF NOT EXISTS agent_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS response_time_ms INTEGER DEFAULT 0;

-- Create index for faster stats aggregation per agent
CREATE INDEX IF NOT EXISTS idx_token_usage_agent_id ON token_usage(agent_id);
