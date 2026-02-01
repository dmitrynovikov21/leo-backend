import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db';

const router = Router();

// Validation schema
const logConflictSchema = z.object({
    agentId: z.string().min(1),
    chatId: z.string().optional().nullable(),
    topic: z.string().min(1),
    conflictingFiles: z.array(z.object({
        file_id: z.string(),
        file_name: z.string(),
        value_found: z.string(),
    })).min(2),
});

const updateConflictSchema = z.object({
    status: z.enum(['NEW', 'RESOLVED', 'IGNORED']),
});

// Generate CUID-like ID
function generateId(): string {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 10);
    return `c${timestamp}${randomPart}`;
}

// POST /api/v1/conflicts - Log a new conflict
router.post('/', async (req: Request, res: Response) => {
    try {
        const parsed = logConflictSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { agentId, chatId, topic, conflictingFiles } = parsed.data;

        // Get user_id for this agent (required by Prisma schema)
        const agentResult = await pool.query(
            `SELECT "userId" FROM agents WHERE id = $1`,
            [agentId]
        );

        if (agentResult.rows.length === 0) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const userId = agentResult.rows[0].userId;
        const id = generateId();

        await pool.query(
            `INSERT INTO knowledge_conflicts (id, "user_id", "agent_id", "chat_id", topic, details, status, "detected_at")
             VALUES ($1, $2, $3, $4, $5, $6, 'NEW', NOW())`,
            [id, userId, agentId, chatId || null, topic, JSON.stringify(conflictingFiles)]
        );

        console.log(`⚠️ Conflict logged: ${topic} (agent: ${agentId})`);

        return res.status(201).json({
            success: true,
            id,
            message: 'Conflict logged successfully',
        });
    } catch (error: any) {
        console.error('Log conflict error:', error.message);
        return res.status(500).json({
            error: 'Failed to log conflict',
            message: error.message,
        });
    }
});

// GET /api/v1/conflicts?agentId=xxx - Get conflicts for an agent
router.get('/', async (req: Request, res: Response) => {
    try {
        const { agentId, status } = req.query;

        if (!agentId || typeof agentId !== 'string') {
            return res.status(400).json({
                error: 'agentId query parameter is required',
            });
        }

        let query = `
            SELECT id, "agent_id", "chat_id", topic, details, status, "detected_at"
            FROM knowledge_conflicts
            WHERE "agent_id" = $1
        `;
        const params: any[] = [agentId];

        if (status && typeof status === 'string') {
            query += ` AND status = $2`;
            params.push(status.toUpperCase());
        }

        query += ` ORDER BY "detected_at" DESC LIMIT 100`;

        const result = await pool.query(query, params);

        return res.json({
            conflicts: result.rows.map(row => ({
                id: row.id,
                agentId: row.agent_id,
                chatId: row.chat_id,
                topic: row.topic,
                details: row.details,
                status: row.status,
                detectedAt: row.detected_at,
            })),
        });
    } catch (error: any) {
        console.error('Get conflicts error:', error.message);
        return res.status(500).json({
            error: 'Failed to get conflicts',
            message: error.message,
        });
    }
});

// PATCH /api/v1/conflicts/:id - Update conflict status
router.patch('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const parsed = updateConflictSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { status } = parsed.data;

        const result = await pool.query(
            `UPDATE knowledge_conflicts SET status = $1 WHERE id = $2 RETURNING *`,
            [status, id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({
                error: 'Conflict not found',
            });
        }

        return res.json({
            success: true,
            conflict: {
                id: result.rows[0].id,
                status: result.rows[0].status,
            },
        });
    } catch (error: any) {
        console.error('Update conflict error:', error.message);
        return res.status(500).json({
            error: 'Failed to update conflict',
            message: error.message,
        });
    }
});

// DELETE /api/v1/conflicts/:id - Delete a conflict
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            `DELETE FROM knowledge_conflicts WHERE id = $1`,
            [id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({
                error: 'Conflict not found',
            });
        }

        return res.status(204).send();
    } catch (error: any) {
        console.error('Delete conflict error:', error.message);
        return res.status(500).json({
            error: 'Failed to delete conflict',
            message: error.message,
        });
    }
});

export default router;
