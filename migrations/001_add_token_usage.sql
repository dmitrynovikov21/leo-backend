-- Token usage table for tracking LLM usage per user
CREATE TABLE IF NOT EXISTS token_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    model VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster user lookups
CREATE INDEX IF NOT EXISTS idx_token_usage_user_id ON token_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_created_at ON token_usage(created_at);

-- Note: The agents table should already exist from your Prisma schema.
-- If not, here's the SQL:

-- CREATE TYPE agent_status AS ENUM ('STOPPED', 'STARTING', 'RUNNING', 'ERROR');

-- CREATE TABLE IF NOT EXISTS agents (
--     id VARCHAR(255) PRIMARY KEY,
--     user_id VARCHAR(255) NOT NULL,
--     name VARCHAR(255) NOT NULL,
--     role VARCHAR(255) NOT NULL,
--     description TEXT NOT NULL,
--     system_prompt TEXT NOT NULL,
--     telegram_token VARCHAR(255),
--     status agent_status DEFAULT 'STOPPED',
--     container_id VARCHAR(255),
--     container_name VARCHAR(255),
--     created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
--     updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
-- );

-- CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);
