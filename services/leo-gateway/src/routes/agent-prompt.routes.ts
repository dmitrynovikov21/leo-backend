import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { litellmService } from '../services/litellm.service';

const router = Router();

const generateAgentPromptSchema = z.object({
    agentName: z.string().min(1, 'Название агента обязательно'),
    role: z.string().min(1, 'Роль агента обязательна'),
    description: z.string().min(1, 'Описание агента обязательно'),
});

router.post('/', async (req: Request, res: Response) => {
    try {
        const parsed = generateAgentPromptSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { agentName, role, description } = parsed.data;

        const systemPrompt = await litellmService.generateAgentPrompt({
            agentName,
            role,
            description,
        });

        return res.json({
            agentName,
            role,
            description,
            systemPrompt,
        });
    } catch (error: any) {
        console.error('Generate agent prompt error:', error.message);
        return res.status(500).json({
            error: 'Failed to generate agent prompt',
            message: error.message,
        });
    }
});

export default router;
