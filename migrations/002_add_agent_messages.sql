-- Agent Messages (conversation context per telegram user)
CREATE TYPE message_type AS ENUM ('HUMAN', 'AI', 'TOOL', 'SYSTEM');

CREATE TABLE IF NOT EXISTS agent_messages (
    id VARCHAR(255) PRIMARY KEY,
    agent_id VARCHAR(255) NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    telegram_user_id BIGINT NOT NULL,
    message_type message_type NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_agent_messages_agent_user ON agent_messages(agent_id, telegram_user_id);
CREATE INDEX idx_agent_messages_created_at ON agent_messages(created_at);

-- Agent Summaries (conversation summaries)
CREATE TABLE IF NOT EXISTS agent_summaries (
    id VARCHAR(255) PRIMARY KEY,
    agent_id VARCHAR(255) NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    telegram_user_id BIGINT NOT NULL,
    summary TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_agent_summaries_agent_user ON agent_summaries(agent_id, telegram_user_id);

-- Prisma schema additions:
-- 
-- enum MessageType {
--   HUMAN
--   AI
--   TOOL
--   SYSTEM
-- }
-- 
-- model AgentMessage {
--   id             String      @id @default(cuid())
--   agentId        String
--   telegramUserId BigInt      @map(name: "telegram_user_id")
--   messageType    MessageType @map(name: "message_type")
--   content        String      @db.Text
--   createdAt      DateTime    @default(now()) @map(name: "created_at")
--   
--   agent          Agent       @relation(fields: [agentId], references: [id], onDelete: Cascade)
--   
--   @@index([agentId, telegramUserId])
--   @@index([createdAt])
--   @@map("agent_messages")
-- }
-- 
-- model AgentSummary {
--   id             String   @id @default(cuid())
--   agentId        String
--   telegramUserId BigInt   @map(name: "telegram_user_id")
--   summary        String   @db.Text
--   createdAt      DateTime @default(now()) @map(name: "created_at")
--   
--   agent          Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
--   
--   @@index([agentId, telegramUserId])
--   @@map("agent_summaries")
-- }
-- 
-- // Update Agent model to add relations:
-- model Agent {
--   // ... existing fields ...
--   messages       AgentMessage[]
--   summaries      AgentSummary[]
-- }
