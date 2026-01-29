-- Add cost tracking fields to token_usage for LLM cost analytics
-- request_type: type of request (AGENT_CHAT, DOCUMENT_PROCESSING, etc.)  
-- real_cost_usd: actual cost from LiteLLM in USD
-- platform_tokens_charged: tokens charged on the platform (for billing)

-- Create enum for request types
DO $$ BEGIN
    CREATE TYPE request_type AS ENUM (
        'AGENT_CHAT',
        'DOCUMENT_PROCESSING', 
        'QUIZ_GENERATION',
        'PROMPT_GENERATION',
        'SUMMARIZATION',
        'OTHER'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add new columns
ALTER TABLE token_usage 
ADD COLUMN IF NOT EXISTS request_type request_type DEFAULT 'OTHER',
ADD COLUMN IF NOT EXISTS real_cost_usd DECIMAL(12, 8) DEFAULT 0,
ADD COLUMN IF NOT EXISTS platform_tokens_charged DECIMAL(12, 2) DEFAULT 0;

-- Index for cost analytics
CREATE INDEX IF NOT EXISTS idx_token_usage_request_type ON token_usage(request_type);
CREATE INDEX IF NOT EXISTS idx_token_usage_real_cost ON token_usage(real_cost_usd) WHERE real_cost_usd > 0;

-- Comments
COMMENT ON COLUMN token_usage.request_type IS 'Type of LLM request for analytics';
COMMENT ON COLUMN token_usage.real_cost_usd IS 'Actual cost from LiteLLM provider in USD';
COMMENT ON COLUMN token_usage.platform_tokens_charged IS 'Platform tokens charged to user balance';
