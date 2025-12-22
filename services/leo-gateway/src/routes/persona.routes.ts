import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { litellmService } from '../services/litellm.service';

const router = Router();

const generatePersonaSchema = z.object({
    userId: z.string(),
    role: z.string().min(1),
    description: z.string().min(1),
});

router.post('/', async (req: Request, res: Response) => {
    try {
        const parsed = generatePersonaSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { userId, role, description } = parsed.data;

        const systemPrompt = await litellmService.generatePersona(role, description);

        return res.json({
            userId,
            role,
            description,
            systemPrompt,
        });
    } catch (error: any) {
        console.error('Generate persona error:', error.message);
        return res.status(500).json({
            error: 'Failed to generate persona',
            message: error.message,
        });
    }
});

export default router;
