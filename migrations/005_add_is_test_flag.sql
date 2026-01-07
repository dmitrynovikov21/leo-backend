-- Add is_test flag to filter test dialogs from analytics

-- Add to agent_messages
ALTER TABLE agent_messages
ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT false;

-- Add to token_usage  
ALTER TABLE token_usage
ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT false;

-- Index for faster filtering
CREATE INDEX IF NOT EXISTS idx_agent_messages_is_test ON agent_messages(is_test) WHERE is_test = false;
CREATE INDEX IF NOT EXISTS idx_token_usage_is_test ON token_usage(is_test) WHERE is_test = false;

-- Comment
COMMENT ON COLUMN agent_messages.is_test IS 'True for test/manual API dialogs, excluded from analytics';
COMMENT ON COLUMN token_usage.is_test IS 'True for test/manual API requests, excluded from analytics';
