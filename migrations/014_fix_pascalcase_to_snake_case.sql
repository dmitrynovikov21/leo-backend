-- Fix PascalCase table/column names to snake_case

-- 1. Rename UserSubscription table and columns
ALTER TABLE IF EXISTS "UserSubscription" RENAME TO user_subscriptions;

ALTER TABLE IF EXISTS user_subscriptions RENAME COLUMN "userId" TO user_id;
ALTER TABLE IF EXISTS user_subscriptions RENAME COLUMN "puBalance" TO pu_balance;
ALTER TABLE IF EXISTS user_subscriptions RENAME COLUMN "puLimit" TO pu_limit;
ALTER TABLE IF EXISTS user_subscriptions RENAME COLUMN "puUsedThisCycle" TO pu_used_this_cycle;
ALTER TABLE IF EXISTS user_subscriptions RENAME COLUMN "isOverdraft" TO is_overdraft;
ALTER TABLE IF EXISTS user_subscriptions RENAME COLUMN "isBlocked" TO is_blocked;
ALTER TABLE IF EXISTS user_subscriptions RENAME COLUMN "createdAt" TO created_at;
ALTER TABLE IF EXISTS user_subscriptions RENAME COLUMN "updatedAt" TO updated_at;

-- 2. Rename PuTransaction table and columns
ALTER TABLE IF EXISTS "PuTransaction" RENAME TO pu_transactions;

ALTER TABLE IF EXISTS pu_transactions RENAME COLUMN "userId" TO user_id;
ALTER TABLE IF EXISTS pu_transactions RENAME COLUMN "type" TO type;
ALTER TABLE IF EXISTS pu_transactions RENAME COLUMN "puAmount" TO pu_amount;
ALTER TABLE IF EXISTS pu_transactions RENAME COLUMN "balanceBefore" TO balance_before;
ALTER TABLE IF EXISTS pu_transactions RENAME COLUMN "balanceAfter" TO balance_after;
ALTER TABLE IF EXISTS pu_transactions RENAME COLUMN "source" TO source;
ALTER TABLE IF EXISTS pu_transactions RENAME COLUMN "description" TO description;
ALTER TABLE IF EXISTS pu_transactions RENAME COLUMN "metadata" TO metadata;
ALTER TABLE IF EXISTS pu_transactions RENAME COLUMN "createdAt" TO created_at;

-- 3. Rename file_processing_cache columns (table name is already snake_case)
ALTER TABLE IF EXISTS file_processing_cache RENAME COLUMN "agentId" TO agent_id;
ALTER TABLE IF EXISTS file_processing_cache RENAME COLUMN "contentHash" TO content_hash;
ALTER TABLE IF EXISTS file_processing_cache RENAME COLUMN "fileSize" TO file_size;
ALTER TABLE IF EXISTS file_processing_cache RENAME COLUMN "chunkCount" TO chunk_count;
ALTER TABLE IF EXISTS file_processing_cache RENAME COLUMN "puCharged" TO pu_charged;
ALTER TABLE IF EXISTS file_processing_cache RENAME COLUMN "chargePercentage" TO charge_percentage;
ALTER TABLE IF EXISTS file_processing_cache RENAME COLUMN "previousVersion" TO previous_version;
ALTER TABLE IF EXISTS file_processing_cache RENAME COLUMN "vectorizationDate" TO vectorization_date;
ALTER TABLE IF EXISTS file_processing_cache RENAME COLUMN "createdAt" TO created_at;

-- 4. Recreate indexes with new names
DROP INDEX IF EXISTS idx_file_cache_agent_hash;
DROP INDEX IF EXISTS idx_file_cache_agent_filename;
DROP INDEX IF EXISTS idx_pu_trans_user;

CREATE INDEX IF NOT EXISTS idx_file_cache_agent_hash ON file_processing_cache(agent_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_file_cache_agent_filename ON file_processing_cache(agent_id, filename);
CREATE INDEX IF NOT EXISTS idx_pu_trans_user ON pu_transactions(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
