import { query, queryOne } from '../db';

interface UsageRecord {
    id: string;
    userId: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    model: string;
    agent_id?: string;
    response_time_ms?: number;
    request_type?: string;
    real_cost_usd?: number;
    platform_tokens_charged?: number;
    is_test?: boolean;
    created_at: Date;
}

interface UsageSummary {
    userId: string;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    requestCount: number;
    totalCostUsd?: number;
    totalPlatformTokensCharged?: number;
}

class UsageService {
    async trackUsage(
        userId: string,
        promptTokens: number,
        completionTokens: number,
        totalTokens: number,
        model: string,
        agentId?: string,
        responseTimeMs: number = 0
    ): Promise<void> {
        await query(
            `INSERT INTO token_usage (id, "userId", prompt_tokens, completion_tokens, total_tokens, model, agent_id, response_time_ms, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW())`,
            [userId, promptTokens, completionTokens, totalTokens, model, agentId || null, responseTimeMs]
        );
    }

    async getUsage(userId: string): Promise<UsageSummary> {
        const result = await queryOne<{
            total_prompt_tokens: string;
            total_completion_tokens: string;
            total_tokens: string;
            request_count: string;
            total_cost_usd: string;
            total_platform_tokens: string;
        }>(
            `SELECT 
         COALESCE(SUM(prompt_tokens), 0) as total_prompt_tokens,
         COALESCE(SUM(completion_tokens), 0) as total_completion_tokens,
         COALESCE(SUM(total_tokens), 0) as total_tokens,
         COUNT(*) as request_count,
         COALESCE(SUM(real_cost_usd), 0) as total_cost_usd,
         COALESCE(SUM(platform_tokens_charged), 0) as total_platform_tokens
       FROM token_usage
       WHERE "userId" = $1`,
            [userId]
        );

        return {
            userId,
            totalPromptTokens: parseInt(result?.total_prompt_tokens || '0', 10),
            totalCompletionTokens: parseInt(result?.total_completion_tokens || '0', 10),
            totalTokens: parseInt(result?.total_tokens || '0', 10),
            requestCount: parseInt(result?.request_count || '0', 10),
            totalCostUsd: parseFloat(result?.total_cost_usd || '0'),
            totalPlatformTokensCharged: parseFloat(result?.total_platform_tokens || '0'),
        };
    }

    async getUsageByPeriod(userId: string, startDate: Date, endDate: Date): Promise<UsageSummary> {
        const result = await queryOne<{
            total_prompt_tokens: string;
            total_completion_tokens: string;
            total_tokens: string;
            request_count: string;
            total_cost_usd: string;
            total_platform_tokens: string;
        }>(
            `SELECT 
         COALESCE(SUM(prompt_tokens), 0) as total_prompt_tokens,
         COALESCE(SUM(completion_tokens), 0) as total_completion_tokens,
         COALESCE(SUM(total_tokens), 0) as total_tokens,
         COUNT(*) as request_count,
         COALESCE(SUM(real_cost_usd), 0) as total_cost_usd,
         COALESCE(SUM(platform_tokens_charged), 0) as total_platform_tokens
       FROM token_usage
       WHERE "userId" = $1 AND created_at >= $2 AND created_at <= $3`,
            [userId, startDate, endDate]
        );

        return {
            userId,
            totalPromptTokens: parseInt(result?.total_prompt_tokens || '0', 10),
            totalCompletionTokens: parseInt(result?.total_completion_tokens || '0', 10),
            totalTokens: parseInt(result?.total_tokens || '0', 10),
            requestCount: parseInt(result?.request_count || '0', 10),
            totalCostUsd: parseFloat(result?.total_cost_usd || '0'),
            totalPlatformTokensCharged: parseFloat(result?.total_platform_tokens || '0'),
        };
    }
}

export const usageService = new UsageService();
