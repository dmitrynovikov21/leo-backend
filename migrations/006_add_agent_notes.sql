-- Migration 006: Add agent notes table with CUIDs

CREATE TABLE IF NOT EXISTS agent_notes (
    id VARCHAR(255) PRIMARY KEY,
    agent_id VARCHAR(255) NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    vector_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_notes_agent_id ON agent_notes(agent_id);
