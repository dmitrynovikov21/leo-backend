/**
 * Agent Chat Routes
 * API for manual agent testing (without Telegram)
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { chatService } from '../services/chat.service';

const router = Router();

// POST /api/v1/agents/:agentId/chat - Send message to agent
router.post('/:agentId/chat', async (req: Request, res: Response) => {
    try {
        const { agentId } = req.params;

        const schema = z.object({
            message: z.string().min(1),
            session_id: z.string().optional().nullable(),
            user_id: z.string().optional().nullable(), // Allow explicit user_id for tracking
            is_test: z.boolean().optional().default(true),
        });

        const parsed = schema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { message, session_id, user_id, is_test } = parsed.data;

        console.log(`💬 [${agentId}] Chat request: "${message.substring(0, 50)}..." (session: ${session_id || 'new'}, user: ${user_id || 'anon'})`);

        const result = await chatService.processMessage(
            agentId,
            session_id || null,
            message,
            user_id || undefined, // Pass explicit userId if provided
            is_test
        );

        return res.json(result);

    } catch (error: any) {
        console.error('Chat error:', error.message);
        if (error.response?.data) {
            console.error('Error details:', JSON.stringify(error.response.data, null, 2));
        }

        if (error.message.includes('not found')) {
            return res.status(404).json({
                error: 'Agent not found',
                message: error.message,
            });
        }

        return res.status(500).json({
            error: 'Failed to process message',
            message: error.message,
        });
    }
});

// POST /api/v1/agents/:agentId/chat/reset - Reset/create session
router.post('/:agentId/chat/reset', async (req: Request, res: Response) => {
    try {
        const { agentId } = req.params;

        const schema = z.object({
            session_id: z.string().optional(),
        });

        const parsed = schema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { session_id } = parsed.data;

        console.log(`🔄 [${agentId}] Reset session: ${session_id || 'create new'}`);

        const result = await chatService.resetSession(agentId, session_id);

        return res.json(result);

    } catch (error: any) {
        console.error('Session reset error:', error.message);
        return res.status(500).json({
            error: 'Failed to reset session',
            message: error.message,
        });
    }
});

// GET /api/v1/agents/:agentId/chat/history - Get session history (optional)
router.get('/:agentId/chat/history', async (req: Request, res: Response) => {
    try {
        const { agentId } = req.params;
        const sessionId = req.query.session_id as string;

        if (!sessionId) {
            return res.status(400).json({ error: 'session_id is required' });
        }

        const messages = await chatService.getRecentMessages(agentId, sessionId, 50);

        return res.json({
            session_id: sessionId,
            messages: messages.map(m => ({
                role: m.messageType === 'HUMAN' ? 'user' : 'assistant',
                content: m.content,
                timestamp: m.createdAt,
            })),
        });

    } catch (error: any) {
        console.error('Get history error:', error.message);
        return res.status(500).json({
            error: 'Failed to get history',
            message: error.message,
        });
    }
});

export default router;
