import { Router, Request, Response } from 'express';
import { usageService } from '../services/usage.service';

const router = Router();

router.get('/:userId', async (req: Request, res: Response) => {
    try {
        const { userId } = req.params;

        if (!userId) {
            return res.status(400).json({
                error: 'userId is required',
            });
        }

        const usage = await usageService.getUsage(userId);

        return res.json(usage);
    } catch (error: any) {
        console.error('Get usage error:', error.message);
        return res.status(500).json({
            error: 'Failed to get usage',
            message: error.message,
        });
    }
});

export default router;
