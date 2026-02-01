import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query } from '../db';

const router = Router();

// Schema for incoming LLM usage webhook data
const llmWebhookSchema = z.object({
    userId: z.string().min(1, 'userId is required'),
    agentId: z.string().optional().nullable(),
    promptTokens: z.number().int().min(0),
    completionTokens: z.number().int().min(0),
    totalTokens: z.number().int().min(0),
    model: z.string().min(1),
    costUsd: z.number().min(0).optional().default(0),
    responseTimeMs: z.number().int().min(0).optional().default(0),
    requestType: z.enum([
        'AGENT_CHAT',
        'DOCUMENT_PROCESSING',
        'QUIZ_GENERATION',
        'PROMPT_GENERATION',
        'SUMMARIZATION',
        'OTHER'
    ]).optional().default('OTHER'),
    platformTokensCharged: z.number().min(0).optional().default(0),
    isTest: z.boolean().optional().default(false),
});

type LLMWebhookPayload = z.infer<typeof llmWebhookSchema>;

/**
 * POST /api/v1/llm-webhook
 * Receives LLM usage data from LiteLLM orchestrator and saves to token_usage table
 */
router.post('/llm-webhook', async (req: Request, res: Response) => {
    try {
        const parsed = llmWebhookSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const data: LLMWebhookPayload = parsed.data;

        await query(
            `INSERT INTO token_usage (
                id,
                "userId",
                agent_id,
                prompt_tokens,
                completion_tokens,
                total_tokens,
                model,
                response_time_ms,
                request_type,
                real_cost_usd,
                platform_tokens_charged,
                is_test,
                created_at
            ) VALUES (
                gen_random_uuid(),
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                $9,
                $10,
                $11,
                NOW()
            )`,
            [
                data.userId,
                data.agentId || null,
                data.promptTokens,
                data.completionTokens,
                data.totalTokens,
                data.model,
                data.responseTimeMs,
                data.requestType,
                data.costUsd,
                data.platformTokensCharged,
                data.isTest,
            ]
        );

        return res.status(201).json({
            success: true,
            message: 'Usage recorded',
        });
    } catch (error: any) {
        // Handle Foreign Key Violation (Postgres code 23503)
        if (error.code === '23503') {
            console.warn(`[LLM Webhook] Skipped usage recording for non-existent user: ${req.body.userId}`);
            return res.status(200).json({
                success: false,
                message: 'User not found, usage skipped',
            });
        }

        console.error('LLM webhook error:', error.message);
        return res.status(500).json({
            error: 'Failed to record usage',
            message: error.message,
        });
    }
});

export default router;
