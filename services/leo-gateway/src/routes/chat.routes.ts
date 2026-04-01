import { config } from '../config';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { litellmService, ChatMessage } from '../services/litellm.service';
import { usageService } from '../services/usage.service';
import * as puChargingService from '../services/pu-charging.service';
import { queryOne } from '../db';

const router = Router();

const chatCompletionSchema = z.object({
    userId: z.string(),
    messages: z.array(z.any()), // Allow all message formats (system, user, assistant, tool, with tool_calls)
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().positive().optional(),
    agentId: z.string().optional(),
    tools: z.any().optional(),
    tool_choice: z.any().optional(),
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

        const { userId, messages, model, temperature, max_tokens, agentId, tools, tool_choice } = parsed.data;

        // check PU balance (Unified Balance System)
        const balanceInfo = await puChargingService.checkPuBalance(userId, 0.1); // check if has at least 0.1 PU

        if (!balanceInfo.hasBalance) {
            return res.status(403).json({
                error: 'Insufficient funds',
                message: 'Your balance is too low to proceed',
                currentBalance: balanceInfo.currentBalance
            });
        }

        const startTime = Date.now();
        const response = await litellmService.chatCompletion({
            userId,
            agentId,
            model,
            messages: messages as ChatMessage[],
            temperature,
            max_tokens,
            tools,
            tool_choice,
        });
        const duration = Date.now() - startTime;

        // Track usage - DISABLED (Relies on LiteLLM Webhook Callback to avoid double counting and get cost data)
        /*
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
        */

        return res.json(response);
    } catch (error: any) {
        console.error('Chat completion error:', error.message);
        return res.status(500).json({
            error: 'Failed to process chat completion',
            ...(config.isDev && { message: error.message }),
        });
    }
});

export default router;
