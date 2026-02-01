-- Migration: Add knowledge_conflicts table for tracking contradictory RAG data

CREATE TABLE IF NOT EXISTS knowledge_conflicts (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    chat_id TEXT,
    topic TEXT NOT NULL,
    details JSONB NOT NULL,
    status TEXT DEFAULT 'new' CHECK (status IN ('new', 'resolved', 'ignored')),
    detected_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conflicts_agent ON knowledge_conflicts(agent_id);
CREATE INDEX IF NOT EXISTS idx_conflicts_status ON knowledge_conflicts(status);
