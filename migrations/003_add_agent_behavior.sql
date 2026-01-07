-- System prompt versions for history (behavior is now in agents table)
CREATE TABLE IF NOT EXISTS system_prompt_versions (
    id VARCHAR(255) PRIMARY KEY,
    agent_id VARCHAR(255) NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    version VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_prompt_versions_agent ON system_prompt_versions(agent_id);
CREATE INDEX IF NOT EXISTS idx_system_prompt_versions_active ON system_prompt_versions(agent_id, is_active) WHERE is_active = true;

-- Function to ensure only one active prompt per agent
CREATE OR REPLACE FUNCTION ensure_single_active_prompt()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_active = true THEN
        UPDATE system_prompt_versions
        SET is_active = false
        WHERE agent_id = NEW.agent_id AND id != NEW.id AND is_active = true;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-deactivate other prompts when one is activated
DROP TRIGGER IF EXISTS trg_single_active_prompt ON system_prompt_versions;
CREATE TRIGGER trg_single_active_prompt
    BEFORE INSERT OR UPDATE OF is_active ON system_prompt_versions
    FOR EACH ROW
    EXECUTE FUNCTION ensure_single_active_prompt();

-- Note: Behavior fields (avatar_emoji, display_name, temperature, tone, guardrails) 
-- are now in the agents table per Prisma schema
