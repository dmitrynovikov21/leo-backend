import { query, queryOne } from '../db';

interface UsageRecord {
    id: string;
    userId: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    model: string;
    created_at: Date;
}

interface UsageSummary {
    userId: string;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    requestCount: number;
}

class UsageService {
    async trackUsage(
        userId: string,
        promptTokens: number,
        completionTokens: number,
        totalTokens: number,
        model: string
    ): Promise<void> {
        await query(
            `INSERT INTO token_usage (id, "userId", prompt_tokens, completion_tokens, total_tokens, model, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())`,
            [userId, promptTokens, completionTokens, totalTokens, model]
        );
    }

    async getUsage(userId: string): Promise<UsageSummary> {
        const result = await queryOne<{
            total_prompt_tokens: string;
            total_completion_tokens: string;
            total_tokens: string;
            request_count: string;
        }>(
            `SELECT 
         COALESCE(SUM(prompt_tokens), 0) as total_prompt_tokens,
         COALESCE(SUM(completion_tokens), 0) as total_completion_tokens,
         COALESCE(SUM(total_tokens), 0) as total_tokens,
         COUNT(*) as request_count
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
        };
    }

    async getUsageByPeriod(userId: string, startDate: Date, endDate: Date): Promise<UsageSummary> {
        const result = await queryOne<{
            total_prompt_tokens: string;
            total_completion_tokens: string;
            total_tokens: string;
            request_count: string;
        }>(
            `SELECT 
         COALESCE(SUM(prompt_tokens), 0) as total_prompt_tokens,
         COALESCE(SUM(completion_tokens), 0) as total_completion_tokens,
         COALESCE(SUM(total_tokens), 0) as total_tokens,
         COUNT(*) as request_count
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
        };
    }
}

export const usageService = new UsageService();
