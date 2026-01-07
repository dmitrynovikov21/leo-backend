import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { agentsService } from '../services/agents.service';

const router = Router();

// Validation schemas
const createAgentSchema = z.object({
    userId: z.string(),
    name: z.string().min(1),
    role: z.string().min(1),
    description: z.string().min(1),
    systemPrompt: z.string().min(1),
    telegramToken: z.string().optional(),
    telegram_token: z.string().optional(),
}).transform((data) => ({
    ...data,
    telegramToken: data.telegramToken ?? data.telegram_token,
}));

const updateAgentSchema = z.object({
    name: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    systemPrompt: z.string().min(1).optional(),
    telegramToken: z.string().optional(),
    telegram_token: z.string().optional(),
}).transform((data) => ({
    ...data,
    telegramToken: data.telegramToken ?? data.telegram_token,
}));

// Helper to sanitize agent for public API
function sanitizeAgent(agent: any) {
    const { telegramToken, ...rest } = agent;
    return {
        ...rest,
        isTelegramConnected: !!telegramToken && telegramToken.trim().length > 0,
    };
}

// GET /api/v1/agents?userId={id} - List agents by user
router.get('/', async (req: Request, res: Response) => {
    try {
        const { userId } = req.query;

        if (!userId || typeof userId !== 'string') {
            return res.status(400).json({
                error: 'userId query parameter is required',
            });
        }

        const agents = await agentsService.getAgentsByUser(userId);
        return res.json(agents.map(sanitizeAgent));
    } catch (error: any) {
        console.error('Get agents error:', error.message);
        return res.status(500).json({
            error: 'Failed to get agents',
            message: error.message,
        });
    }
});

// POST /api/v1/agents - Create agent
router.post('/', async (req: Request, res: Response) => {
    try {
        const parsed = createAgentSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const agent = await agentsService.createAgent(parsed.data);
        return res.status(201).json(sanitizeAgent(agent));
    } catch (error: any) {
        console.error('Create agent error:', error.message);
        return res.status(500).json({
            error: 'Failed to create agent',
            message: error.message,
        });
    }
});

// GET /api/v1/agents/:id - Get agent by ID
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const agent = await agentsService.getAgentById(id);

        if (!agent) {
            return res.status(404).json({
                error: 'Agent not found',
            });
        }

        return res.json(sanitizeAgent(agent));
    } catch (error: any) {
        console.error('Get agent error:', error.message);
        return res.status(500).json({
            error: 'Failed to get agent',
            message: error.message,
        });
    }
});

// PUT /api/v1/agents/:id - Update agent
router.put('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const parsed = updateAgentSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const agent = await agentsService.updateAgent(id, parsed.data);

        if (!agent) {
            return res.status(404).json({
                error: 'Agent not found',
            });
        }

        return res.json(sanitizeAgent(agent));
    } catch (error: any) {
        console.error('Update agent error:', error.message);
        return res.status(500).json({
            error: 'Failed to update agent',
            message: error.message,
        });
    }
});

const getStatsPeriodSchema = z.object({
    from: z.string().datetime(),
    to: z.string().datetime(),
});

// GET /api/v1/agents/stats/overview - Get global user stats
router.get('/stats/overview', async (req: Request, res: Response) => {
    try {
        const userId = req.headers['x-user-id'] as string; // Assuming auth middleware adds this header

        // Fallback for dev/test without auth middleware
        const targetUserId = userId || 'user123';

        const stats = await agentsService.getUserStats(targetUserId);

        return res.json(stats);
    } catch (error: any) {
        console.error('Get user stats error:', error.message);
        return res.status(500).json({
            error: 'Failed to get user stats',
            message: error.message,
        });
    }
});

// GET /api/v1/agents/stats/history - Get user stats history (breakdowns)
router.get('/stats/history', async (req: Request, res: Response) => {
    try {
        const userId = req.headers['x-user-id'] as string;
        const targetUserId = userId || 'user123';

        const history = await agentsService.getUserStatsHistory(targetUserId);

        return res.json(history);
    } catch (error: any) {
        console.error('Get user stats history error:', error.message);
        return res.status(500).json({
            error: 'Failed to get user stats history',
            message: error.message,
        });
    }
});

// GET /api/v1/agents/:id/stats - Get agent statistics
router.get('/:id/stats', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const stats = await agentsService.getAgentStats(id);

        return res.json(stats);
    } catch (error: any) {
        console.error('Get agent stats error:', error.message);
        return res.status(500).json({
            error: 'Failed to get agent stats',
            message: error.message,
        });
    }
});

// GET /api/v1/agents/:id/stats/period - Get agent statistics by period
router.get('/:id/stats/period', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const parsed = getStatsPeriodSchema.safeParse(req.query);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { from, to } = parsed.data;
        const stats = await agentsService.getAgentStatsByPeriod(id, new Date(from), new Date(to));

        return res.json(stats);
    } catch (error: any) {
        console.error('Get agent stats by period error:', error.message);
        return res.status(500).json({
            error: 'Failed to get agent period stats',
            message: error.message,
        });
    }
});

// PATCH /api/v1/agents/:id - Update agent (partial)
router.patch('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const parsed = updateAgentSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const agent = await agentsService.updateAgent(id, parsed.data);

        if (!agent) {
            return res.status(404).json({
                error: 'Agent not found',
            });
        }

        return res.json(sanitizeAgent(agent));
    } catch (error: any) {
        console.error('Update agent error:', error.message);
        return res.status(500).json({
            error: 'Failed to update agent',
            message: error.message,
        });
    }
});

// DELETE /api/v1/agents/:id - Delete agent
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        await agentsService.deleteAgent(id);
        return res.status(204).send();
    } catch (error: any) {
        console.error('Delete agent error:', error.message);
        return res.status(500).json({
            error: 'Failed to delete agent',
            message: error.message,
        });
    }
});

// POST /api/v1/agents/:id/start - Start agent container
router.post('/:id/start', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const agent = await agentsService.startAgent(id);

        if (!agent) {
            return res.status(404).json({
                error: 'Agent not found',
            });
        }

        return res.json(sanitizeAgent(agent));
    } catch (error: any) {
        console.error('Start agent error:', error.message);
        return res.status(500).json({
            error: 'Failed to start agent',
            message: error.message,
        });
    }
});

// POST /api/v1/agents/:id/stop - Stop agent container
router.post('/:id/stop', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const agent = await agentsService.stopAgent(id);

        if (!agent) {
            return res.status(404).json({
                error: 'Agent not found',
            });
        }

        return res.json(sanitizeAgent(agent));
    } catch (error: any) {
        console.error('Stop agent error:', error.message);
        return res.status(500).json({
            error: 'Failed to stop agent',
            message: error.message,
        });
    }
});

// GET /api/v1/agents/:id/status - Get agent status
router.get('/:id/status', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const result = await agentsService.getAgentStatus(id);

        if (!result) {
            return res.status(404).json({
                error: 'Agent not found',
            });
        }

        return res.json({
            agent: sanitizeAgent(result.agent),
            container: result.container,
        });
    } catch (error: any) {
        console.error('Get agent status error:', error.message);
        return res.status(500).json({
            error: 'Failed to get agent status',
            message: error.message,
        });
    }
});

export default router;
