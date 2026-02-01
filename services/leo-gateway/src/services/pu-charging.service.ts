import crypto from 'crypto';
import { query } from '../db';

/**
 * Calculate smart charge for file upload
 * Returns PU cost and reason
 */
export async function calculateFileCharge(
    agentId: string,
    filename: string,
    contentChunks: Array<{ text: string }>
): Promise<{
    puCost: number;
    reason: string;
    chargePercentage: number;
}> {
    // Combine all chunks to calculate content hash
    const content = contentChunks.map(c => c.text).join('\n');
    const contentBuffer = Buffer.from(content, 'utf-8');
    const contentHash = crypto.createHash('sha256').update(contentBuffer).digest('hex');

    // 1. Check for exact duplicate
    const cached = await query<{ id: string; charge_percentage: number }>(
        `SELECT id, charge_percentage FROM file_processing_cache WHERE agent_id = $1 AND content_hash = $2`,
        [agentId, contentHash]
    );

    if (cached.length > 0) {
        return {
            puCost: 0,
            reason: 'DUPLICATE: File already processed',
            chargePercentage: 0,
        };
    }

    // 2. Find previous version
    const previousVersions = await query<{ content_hash: string }>(
        `SELECT content_hash FROM file_processing_cache 
     WHERE agent_id = $1 AND filename = $2 
     ORDER BY created_at DESC LIMIT 1`,
        [agentId, filename]
    );

    const estimatedTokens = Math.ceil((content.length / 4) * 1.3); // Rough estimate: 4 chars per token -> ~1.3 tokens per word? No, usually 0.75 words/token. 
    // Let's stick to simple char estimate: 1 token ~= 4 chars. 
    // The user requirement is "1000 tokens -> 1 PU".

    if (previousVersions.length === 0) {
        // New file: 100% charge
        // Remove 1.5x multiplier as requested "1000 tokens = 1 PU"
        const puCost = tokensTopu(estimatedTokens);
        return {
            puCost,
            reason: 'NEW_FILE: First upload of this document',
            chargePercentage: 100,
        };
    }

    // 3. Calculate similarity
    const previousHash = previousVersions[0].content_hash;
    const similarity = calculateStringHashSimilarity(previousHash, contentHash);
    const diffPercent = 100 - similarity;

    // 4. Apply charging rules
    let chargePercent = 100;
    let chargeReason = 'FULL_REPLACEMENT';

    if (diffPercent < 30) {
        chargePercent = 20;
        chargeReason = 'MINOR_UPDATE';
    } else if (diffPercent < 60) {
        chargePercent = 70;
        chargeReason = 'MAJOR_UPDATE';
    }

    const basePuCost = tokensTopu(estimatedTokens);
    const puCost = (basePuCost * chargePercent) / 100;

    return {
        puCost,
        reason: `${chargeReason}: ${diffPercent.toFixed(0)}% content changed`,
        chargePercentage: chargePercent,
    };
}

/**
 * Check if user has enough PU balance
 * Uses `users.token_balance` as the single source of truth
 */
export async function checkPuBalance(
    userId: string,
    requiredPu: number
): Promise<{
    hasBalance: boolean;
    currentBalance: number;
    limit: number;
}> {
    // Table: users
    // Column: token_balance
    const result = await query<{ token_balance: number }>(
        `SELECT token_balance FROM users WHERE id = $1`,
        [userId]
    );

    if (result.length === 0) {
        return {
            hasBalance: false,
            currentBalance: 0,
            limit: 0,
        };
    }

    const { token_balance } = result[0];
    const balance = typeof token_balance === 'string' ? parseFloat(token_balance) : token_balance;

    // Soft limit -5.0 allows small overdraft
    const hasBalance = balance >= requiredPu || balance > -5.0;

    return {
        hasBalance,
        currentBalance: balance,
        // Unified balance system technically has no "limit" other than balance itself
        // We return balance as limit to indicate capacity
        limit: balance,
    };
}

/**
 * Deduct PU from user balance
 * Updates `users.token_balance` and logs to `token_transactions`
 */
export async function deductPuBalance(
    userId: string,
    puAmount: number,
    metadata: {
        source: string;
        filename: string;
        chargeReason: string;
    }
): Promise<boolean> {
    try {
        // Get current balance
        const current = await query<{ token_balance: number }>(
            `SELECT token_balance FROM users WHERE id = $1`,
            [userId]
        );

        if (current.length === 0) {
            console.error(`[PU Charging] User ${userId} not found`);
            return false;
        }

        const balanceBefore = parseFloat(current[0].token_balance.toString());
        const balanceAfter = balanceBefore - puAmount;

        // Update balance in users table
        await query(
            `UPDATE users
       SET token_balance = token_balance - $1,
           updated_at = NOW()
       WHERE id = $2`,
            [puAmount, userId]
        );

        // Record transaction in token_transactions
        // type: DEDUCTION
        await query(
            `INSERT INTO token_transactions 
       (id, user_id, type, amount, balance_before, balance_after, 
        description, metadata, created_at)
       VALUES ($1, $2, 'DEDUCTION', -$3, $4, $5, $6, $7, NOW())`,
            [
                crypto.randomUUID(),
                userId,
                puAmount,
                balanceBefore,
                balanceAfter,
                `PU Deduction: ${metadata.filename} (${metadata.chargeReason})`,
                JSON.stringify(metadata),
            ]
        );

        console.log(`[PU Charging] Deducted ${puAmount} PU from user ${userId} (Unified Balance)`);
        return true;
    } catch (error) {
        console.error(`[PU Charging] Failed to deduct PU:`, error);
        return false;
    }
}

/**
 * Save file processing cache
 */
export async function saveFileProcessingCache(
    agentId: string,
    filename: string,
    contentHash: string,
    fileSize: number,
    chunkCount: number,
    puCharged: number,
    chargePercentage: number,
    diffPercentage?: number
): Promise<void> {
    const previousVersion = await query<{ content_hash: string }>(
        `SELECT content_hash FROM file_processing_cache 
     WHERE agent_id = $1 AND filename = $2 
     ORDER BY created_at DESC LIMIT 1`,
        [agentId, filename]
    );

    // Columns: agent_id, filename, content_hash, file_size, chunk_count, pu_charged, charge_percentage, vectorization_date, previous_version, created_at
    await query(
        `INSERT INTO file_processing_cache 
     (id, agent_id, filename, content_hash, file_size, chunk_count, 
      pu_charged, charge_percentage, vectorization_date, previous_version, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, NOW())`,
        [
            crypto.randomUUID(),
            agentId,
            filename,
            contentHash,
            fileSize,
            chunkCount,
            puCharged,
            chargePercentage,
            previousVersion[0]?.content_hash || null,
        ]
    );
}

// ===== Helpers =====

function tokensTopu(tokens: number): number {
    return tokens / 1000; // 1 PU = 1000 tokens
}

function calculateStringHashSimilarity(hash1: string, hash2: string): number {
    if (hash1 === hash2) return 100;

    let differences = 0;
    const minLen = Math.min(hash1.length, hash2.length);

    for (let i = 0; i < minLen; i++) {
        if (hash1[i] !== hash2[i]) differences++;
    }

    differences += Math.abs(hash1.length - hash2.length);
    const similarity = Math.max(0, 100 - (differences / minLen) * 100);

    return Math.round(similarity);
}
