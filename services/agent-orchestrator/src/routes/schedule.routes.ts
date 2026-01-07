import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { scheduleService } from '../services/schedule.service';

const router = Router();

// Validation schema for schedule
// schedule: 7 arrays (Mon-Sun), each with 24 booleans (hours 0-23)
const updateScheduleSchema = z.object({
    schedule: z.array(
        z.array(z.boolean()).length(24)
    ).length(7).optional(),
    holidays: z.array(
        z.string().regex(/^\d{2}\.\d{2}\.\d{4}$/, 'Date must be in DD.MM.YYYY format')
    ).optional(),
    message: z.string().max(1000).optional(),
});

// GET /api/v1/agents/:id/schedule - Get schedule settings
router.get('/:id/schedule', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const schedule = await scheduleService.getSchedule(id);

        if (!schedule) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        return res.json(schedule);
    } catch (error: any) {
        console.error('Get schedule error:', error.message);
        return res.status(500).json({
            error: 'Failed to get schedule',
            message: error.message,
        });
    }
});

// PUT /api/v1/agents/:id/schedule - Update schedule settings
router.put('/:id/schedule', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const parsed = updateScheduleSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const schedule = await scheduleService.updateSchedule(id, parsed.data);

        if (!schedule) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        return res.json(schedule);
    } catch (error: any) {
        console.error('Update schedule error:', error.message);
        return res.status(500).json({
            error: 'Failed to update schedule',
            message: error.message,
        });
    }
});

export default router;
