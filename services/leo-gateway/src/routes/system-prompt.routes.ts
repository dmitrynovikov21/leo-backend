/**
 * System Prompt Routes
 * Provides API access to platform-level prompts and assembled agent prompts
 */

import { Router, Request, Response } from 'express';
import { PLATFORM_CORE_PROMPT } from '../constants/prompts';
import { queryOne } from '../db';

const router = Router();

/**
 * GET /api/v1/system-prompts/:slug
 * Get platform system prompt by slug
 */
router.get('/:slug', async (req: Request, res: Response) => {
    try {
        const { slug } = req.params;

        // Currently only platform_core is supported
        if (slug === 'platform_core') {
            return res.json({
                slug: 'platform_core',
                content: PLATFORM_CORE_PROMPT,
            });
        }

        return res.status(404).json({
            error: 'System prompt not found',
        });
    } catch (error: any) {
        console.error('Get system prompt error:', error.message);
        return res.status(500).json({
            error: 'Failed to get system prompt',
            message: error.message,
        });
    }
});

/**
 * GET /api/v1/agents/:agentId/prompt-preview
 * Get assembled prompt preview for an agent (without RAG/notes context)
 */
router.get('/agents/:agentId/prompt-preview', async (req: Request, res: Response) => {
    try {
        const { agentId } = req.params;

        const agent = await queryOne<{
            systemPrompt: string;
            name: string;
            display_name: string | null;
            temperature: number;
            tone: string[] | null;
            guardrails: { id: string; rule: string }[] | null;
        }>(
            `SELECT "systemPrompt", name, display_name, temperature, tone, guardrails FROM agents WHERE id = $1`,
            [agentId]
        );

        if (!agent) {
            return res.status(404).json({
                error: 'Agent not found',
            });
        }

        // Build full prompt following the same logic as chat.service.ts
        let fullPrompt = PLATFORM_CORE_PROMPT;

        // Add agent identity
        if (agent.display_name) {
            fullPrompt += `\n\nТы — ${agent.display_name}.`;
        }

        // Add agent system prompt
        if (agent.systemPrompt) {
            fullPrompt += `\n\n${agent.systemPrompt}`;
        }

        // Add tone instructions
        if (agent.tone && agent.tone.length > 0) {
            fullPrompt += `\n\n## ТОН ОБЩЕНИЯ\nИспользуй следующий тон в общении: ${agent.tone.join(', ')}.`;
        }

        // Add guardrails
        if (agent.guardrails && agent.guardrails.length > 0) {
            fullPrompt += `\n\n## ОГРАНИЧЕНИЯ (СТРОГО СОБЛЮДАЙ)\n`;
            for (const g of agent.guardrails) {
                fullPrompt += `- ${g.rule}\n`;
            }
        }

        return res.json({
            fullPrompt,
            layers: {
                platform: PLATFORM_CORE_PROMPT,
                agent: agent.systemPrompt || '',
                behavior: {
                    displayName: agent.display_name,
                    tone: agent.tone || [],
                    guardrails: agent.guardrails || [],
                },
            },
        });
    } catch (error: any) {
        console.error('Get prompt preview error:', error.message);
        return res.status(500).json({
            error: 'Failed to get prompt preview',
            message: error.message,
        });
    }
});

export default router;
