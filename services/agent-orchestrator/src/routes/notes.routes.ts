import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { config } from '../config';

const router = Router();

interface Note {
    id: string;
    agent_id: string;
    title: string;
    content: string;
    vector_id: string | null;
    created_at: Date;
    updated_at: Date;
}

function generateCuid(): string {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 10);
    return `c${timestamp}${randomPart}`;
}

// Vectorize content via leo-gateway
async function vectorizeNote(agentId: string, noteId: string, content: string): Promise<string> {
    const vectorId = `${agentId}_note_${noteId}_${Date.now()}`;

    const response = await fetch(`${config.gatewayUrl}/api/v1/documents/vectorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            agentId,
            userId: 'system', // Notes are system-level
            filename: `note_${noteId}`,
            fileSize: Buffer.byteLength(content, 'utf-8'),
            mimeType: 'text/plain',
            chunks: [{ index: 0, text: content }], // Single chunk - entire note
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Vectorization failed: ${error}`);
    }

    return vectorId;
}

// Delete vectors for a note
async function deleteNoteVectors(agentId: string, noteId: string): Promise<void> {
    try {
        // Delete by source filename pattern
        const response = await fetch(`${config.gatewayUrl}/api/v1/documents/delete-by-source`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                agentId,
                source: `note_${noteId}`,
            }),
        });

        if (!response.ok) {
            console.warn(`Failed to delete vectors for note ${noteId}`);
        }
    } catch (error) {
        console.warn('Vector deletion error:', error);
    }
}

// POST /api/v1/agents/:agentId/notes - Create note
router.post('/:agentId/notes', async (req: Request, res: Response) => {
    try {
        const { agentId } = req.params;

        const schema = z.object({
            title: z.string().min(1),
            content: z.string().min(1),
        });

        const parsed = schema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { title, content } = parsed.data;
        const noteId = generateCuid();
        const now = new Date();

        // 1. Save note to DB first
        await query(
            `INSERT INTO agent_notes (id, agent_id, title, content, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $5)`,
            [noteId, agentId, title, content, now]
        );

        // 2. Vectorize content
        try {
            const vectorId = await vectorizeNote(agentId, noteId, content);

            // Update with vectorId
            await query(
                `UPDATE agent_notes SET vector_id = $1, updated_at = $2 WHERE id = $3`,
                [vectorId, new Date(), noteId]
            );
        } catch (vectorError: any) {
            console.error('Vectorization failed:', vectorError.message);
            // Note is saved but not vectorized - can retry later
        }

        return res.status(201).json({
            id: noteId,
            title,
            created_at: now.toISOString(),
        });
    } catch (error: any) {
        console.error('Create note error:', error.message);
        return res.status(500).json({
            error: 'Failed to create note',
            message: error.message,
        });
    }
});

// GET /api/v1/agents/:agentId/notes - List notes
router.get('/:agentId/notes', async (req: Request, res: Response) => {
    try {
        const { agentId } = req.params;

        const notes = await query<Note>(
            `SELECT id, title, content, vector_id, created_at, updated_at
             FROM agent_notes
             WHERE agent_id = $1
             ORDER BY created_at DESC`,
            [agentId]
        );

        return res.json(notes.map(note => ({
            id: note.id,
            title: note.title,
            content: note.content,
            vectorized: !!note.vector_id,
            created_at: note.created_at,
            updated_at: note.updated_at,
        })));
    } catch (error: any) {
        console.error('Get notes error:', error.message);
        return res.status(500).json({
            error: 'Failed to get notes',
            message: error.message,
        });
    }
});

// PUT /api/v1/agents/:agentId/notes/:noteId - Update note
router.put('/:agentId/notes/:noteId', async (req: Request, res: Response) => {
    try {
        const { agentId, noteId } = req.params;

        const schema = z.object({
            title: z.string().min(1).optional(),
            content: z.string().min(1).optional(),
        });

        const parsed = schema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: parsed.error.flatten().fieldErrors,
            });
        }

        // Check note exists
        const existingNote = await queryOne<Note>(
            `SELECT * FROM agent_notes WHERE id = $1 AND agent_id = $2`,
            [noteId, agentId]
        );

        if (!existingNote) {
            return res.status(404).json({ error: 'Note not found' });
        }

        const { title, content } = parsed.data;
        const newTitle = title ?? existingNote.title;
        const newContent = content ?? existingNote.content;
        const now = new Date();

        // Update note in DB
        await query(
            `UPDATE agent_notes SET title = $1, content = $2, updated_at = $3 WHERE id = $4`,
            [newTitle, newContent, now, noteId]
        );

        // If content changed, re-vectorize
        if (content && content !== existingNote.content) {
            // Delete old vectors
            await deleteNoteVectors(agentId, noteId);

            // Vectorize new content
            try {
                const vectorId = await vectorizeNote(agentId, noteId, newContent);
                await query(
                    `UPDATE agent_notes SET vector_id = $1 WHERE id = $2`,
                    [vectorId, noteId]
                );
            } catch (vectorError: any) {
                console.error('Re-vectorization failed:', vectorError.message);
            }
        }

        const updatedNote = await queryOne<Note>(
            `SELECT * FROM agent_notes WHERE id = $1`,
            [noteId]
        );

        return res.json({
            id: updatedNote!.id,
            title: updatedNote!.title,
            content: updatedNote!.content,
            vectorized: !!updatedNote!.vector_id,
            created_at: updatedNote!.created_at,
            updated_at: updatedNote!.updated_at,
        });
    } catch (error: any) {
        console.error('Update note error:', error.message);
        return res.status(500).json({
            error: 'Failed to update note',
            message: error.message,
        });
    }
});

// DELETE /api/v1/agents/:agentId/notes/:noteId - Delete note
router.delete('/:agentId/notes/:noteId', async (req: Request, res: Response) => {
    try {
        const { agentId, noteId } = req.params;

        // Check note exists
        const note = await queryOne<Note>(
            `SELECT * FROM agent_notes WHERE id = $1 AND agent_id = $2`,
            [noteId, agentId]
        );

        if (!note) {
            return res.status(404).json({ error: 'Note not found' });
        }

        // Delete vectors
        await deleteNoteVectors(agentId, noteId);

        // Delete from DB
        await query(`DELETE FROM agent_notes WHERE id = $1`, [noteId]);

        return res.status(204).send();
    } catch (error: any) {
        console.error('Delete note error:', error.message);
        return res.status(500).json({
            error: 'Failed to delete note',
            message: error.message,
        });
    }
});

export default router;
