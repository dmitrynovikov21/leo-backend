import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { behaviorService } from '../services/behavior.service';

const router = Router();

// Validation schemas
const updateBehaviorSchema = z.object({
    displayName: z.string().optional(),
    avatarEmoji: z.string().max(10).optional(),
    temperature: z.number().min(0).max(2).optional(),
    debounceMs: z.number().min(500).max(30000).optional(),
    welcomeMessage: z.string().max(1000).optional(),
    tone: z.array(z.string()).optional(),
    guardrails: z.array(z.object({
        rule: z.string().min(1),
    })).optional(),
});

const createPromptSchema = z.object({
    version: z.string().min(1),
    content: z.string().min(1),
});

// GET /api/v1/agents/:id/behavior - Get behavior settings
router.get('/:id/behavior', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const behavior = await behaviorService.getBehavior(id);

        if (!behavior) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        return res.json({
            avatarEmoji: behavior.avatarEmoji,
            displayName: behavior.displayName,
            temperature: behavior.temperature,
            debounceMs: behavior.debounceMs,
            welcomeMessage: behavior.welcomeMessage,
            tone: behavior.tone,
            guardrails: behavior.guardrails,
        });
    } catch (error: any) {
        console.error('Get behavior error:', error.message);
        return res.status(500).json({
            error: 'Failed to get behavior',
            message: error.message,
        });
    }
});

// PATCH /api/v1/agents/:id/behavior - Update behavior settings
router.patch('/:id/behavior', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const parsed = updateBehaviorSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const behavior = await behaviorService.updateBehavior(id, parsed.data);

        if (!behavior) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        return res.json({
            avatarEmoji: behavior.avatarEmoji,
            displayName: behavior.displayName,
            temperature: behavior.temperature,
            debounceMs: behavior.debounceMs,
            welcomeMessage: behavior.welcomeMessage,
            tone: behavior.tone,
            guardrails: behavior.guardrails,
        });
    } catch (error: any) {
        console.error('Update behavior error:', error.message);
        return res.status(500).json({
            error: 'Failed to update behavior',
            message: error.message,
        });
    }
});

// GET /api/v1/agents/:id/prompts - List prompt versions
router.get('/:id/prompts', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const result = await behaviorService.getPromptVersions(id);

        if (!result) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        return res.json({
            versions: result.versions.map((v) => ({
                id: v.id,
                version: v.version,
                isActive: v.isActive,
                createdAt: v.createdAt.toISOString(),
            })),
            activePrompt: result.activePrompt ? {
                id: result.activePrompt.id,
                content: result.activePrompt.content,
            } : null,
        });
    } catch (error: any) {
        console.error('Get prompts error:', error.message);
        return res.status(500).json({
            error: 'Failed to get prompts',
            message: error.message,
        });
    }
});

// POST /api/v1/agents/:id/prompts - Create new prompt version
router.post('/:id/prompts', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const parsed = createPromptSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const version = await behaviorService.createPromptVersion(id, parsed.data);

        if (!version) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        return res.status(201).json({
            id: version.id,
            version: version.version,
            content: version.content,
            isActive: version.isActive,
            createdAt: version.createdAt.toISOString(),
        });
    } catch (error: any) {
        console.error('Create prompt error:', error.message);
        return res.status(500).json({
            error: 'Failed to create prompt',
            message: error.message,
        });
    }
});

// PATCH /api/v1/agents/:id/prompts/:versionId - Update prompt version content
const updatePromptSchema = z.object({
    version: z.string().min(1).optional(),
    content: z.string().min(1).optional(),
});

router.patch('/:id/prompts/:versionId', async (req: Request, res: Response) => {
    try {
        const { id, versionId } = req.params;
        const parsed = updatePromptSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const version = await behaviorService.updatePromptVersion(id, versionId, parsed.data);

        if (!version) {
            return res.status(404).json({ error: 'Prompt version not found' });
        }

        return res.json({
            id: version.id,
            version: version.version,
            content: version.content,
            isActive: version.isActive,
            createdAt: version.createdAt.toISOString(),
        });
    } catch (error: any) {
        console.error('Update prompt error:', error.message);
        return res.status(500).json({
            error: 'Failed to update prompt',
            message: error.message,
        });
    }
});


// PATCH /api/v1/agents/:id/prompts/:versionId/activate - Activate prompt version
router.patch('/:id/prompts/:versionId/activate', async (req: Request, res: Response) => {
    try {
        const { id, versionId } = req.params;
        const version = await behaviorService.activatePromptVersion(id, versionId);

        if (!version) {
            return res.status(404).json({ error: 'Prompt version not found' });
        }

        return res.json({
            id: version.id,
            version: version.version,
            content: version.content,
            isActive: version.isActive,
            createdAt: version.createdAt.toISOString(),
        });
    } catch (error: any) {
        console.error('Activate prompt error:', error.message);
        return res.status(500).json({
            error: 'Failed to activate prompt',
            message: error.message,
        });
    }
});

export default router;
