import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { litellmService, ChatMessage } from '../services/litellm.service';
import { usageService } from '../services/usage.service';

const router = Router();

const chatCompletionSchema = z.object({
    userId: z.string(),
    messages: z.array(
        z.object({
            role: z.enum(['system', 'user', 'assistant']),
            content: z.string(),
        })
    ),
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().positive().optional(),
    agentId: z.string().optional(),
});

router.post('/completions', async (req: Request, res: Response) => {
    try {
        const parsed = chatCompletionSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { userId, messages, model, temperature, max_tokens, agentId } = parsed.data;

        const startTime = Date.now();
        const response = await litellmService.chatCompletion({
            model,
            messages: messages as ChatMessage[],
            temperature,
            max_tokens,
        });
        const duration = Date.now() - startTime;

        // Track usage
        if (response.usage) {
            await usageService.trackUsage(
                userId,
                response.usage.prompt_tokens,
                response.usage.completion_tokens,
                response.usage.total_tokens,
                response.model,
                agentId,
                duration
            );
        }

        return res.json(response);
    } catch (error: any) {
        console.error('Chat completion error:', error.message);
        return res.status(500).json({
            error: 'Failed to process chat completion',
            message: error.message,
        });
    }
});

export default router;
