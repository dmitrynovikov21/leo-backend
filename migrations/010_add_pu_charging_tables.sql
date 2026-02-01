-- PU Charging System Tables

-- 1. File Processing Cache for Smart Charging
CREATE TABLE IF NOT EXISTS file_processing_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "agentId" VARCHAR(255) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    "contentHash" VARCHAR(255) NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "chunkCount" INTEGER NOT NULL,
    "puCharged" DECIMAL(12, 4) NOT NULL DEFAULT 0,
    "chargePercentage" INTEGER NOT NULL DEFAULT 100,
    "previousVersion" VARCHAR(255), -- Hash of the previous version if this is an update
    "vectorizationDate" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_file_cache_agent_hash ON file_processing_cache("agentId", "contentHash");
CREATE INDEX IF NOT EXISTS idx_file_cache_agent_filename ON file_processing_cache("agentId", filename);

-- 2. User Subscription (Simplified if not exists)
CREATE TABLE IF NOT EXISTS "UserSubscription" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" VARCHAR(255) NOT NULL UNIQUE,
    "puBalance" DECIMAL(12, 4) DEFAULT 0,
    "puLimit" DECIMAL(12, 4) DEFAULT 100,
    "puUsedThisCycle" DECIMAL(12, 4) DEFAULT 0,
    "isOverdraft" BOOLEAN DEFAULT FALSE,
    "isBlocked" BOOLEAN DEFAULT FALSE,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Pu Transaction Log
CREATE TABLE IF NOT EXISTS "PuTransaction" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" VARCHAR(255) NOT NULL,
    "type" VARCHAR(50) NOT NULL, -- OVERAGE_DEDUCTION, REFILL, etc.
    "puAmount" DECIMAL(12, 4) NOT NULL, -- Negative for deduction
    "balanceBefore" DECIMAL(12, 4) NOT NULL,
    "balanceAfter" DECIMAL(12, 4) NOT NULL,
    "source" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pu_trans_user ON "PuTransaction"("userId");
