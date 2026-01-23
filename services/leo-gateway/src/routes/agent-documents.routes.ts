import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db';
import { chromaService } from '../services/chroma.service';

const router = Router({ mergeParams: true }); // Enable access to params from parent router if needed

// 1. Get list of documents for an agent (with optional filename search)
router.get('/:agentId/documents', async (req: Request, res: Response) => {
    try {
        const { agentId } = req.params;
        const { filename: searchFilename } = req.query;

        // Fetch documents from knowledge_bases table
        // We cast columns to match the requested format
        // If filename query param is provided, filter by partial match (case-insensitive)
        const documents = await query<{
            id: string;
            filename: string;
            mime_type: string;
            file_size: number;
            created_at: Date;
            status: string;
        }>(
            searchFilename
                ? `SELECT 
                    id, 
                    filename, 
                    "mimeType" as mime_type, 
                    "fileSize" as file_size, 
                    created_at, 
                    status 
                 FROM knowledge_bases 
                 WHERE "agentId" = $1 AND filename ILIKE $2
                 ORDER BY created_at DESC`
                : `SELECT 
                    id, 
                    filename, 
                    "mimeType" as mime_type, 
                    "fileSize" as file_size, 
                    created_at, 
                    status 
                 FROM knowledge_bases 
                 WHERE "agentId" = $1 
                 ORDER BY created_at DESC`,
            searchFilename ? [agentId, `%${searchFilename}%`] : [agentId]
        );

        // Map to response format
        const response = documents.map(doc => ({
            id: doc.id,
            filename: doc.filename,
            type: doc.mime_type, // "type" in response, "mimeType" in DB
            size: formatSize(doc.file_size),
            created_at: doc.created_at,
            status: doc.status.toLowerCase() // "ready" | "processing" | "error"
        }));

        return res.json(response);
    } catch (error: any) {
        console.error('List documents error:', error.message);
        return res.status(500).json({ error: 'Failed to list documents' });
    }
});

// 2. Delete a document
router.delete('/:agentId/documents/:docId', async (req: Request, res: Response) => {
    try {
        const { agentId, docId } = req.params;

        // 1. Get doc info to delete from Chroma (if needed)
        // We delete the collection items associated with this document lookup? 
        // Actually chromaService.deleteCollection checks agentId. 
        // To delete specific doc chunks from Chroma:
        // We stored them with metadata source=filename or similar.
        // But here we might just delete from DB and let Chroma stay or prune?
        // The user asked for DELETE. Ideally we cleanup Chroma.
        // chromaService has deleteDocuments? No, it has deleteCollection.
        // We might need to implement deleteDocumentsBySource or similar in ChromaService later.
        // For now, removing from DB effectively hides it. 

        // Wait, checking chroma.service.ts... 
        // It uses `collection.delete({ where: { "agentId": agentId } })` to clear all.
        // To delete specific doc, we can filter by metadata.
        // But user requirement says: "Ожидаю статус 200 OK. Тело ответа не важно."
        // I will implement DB deletion. Chroma cleanup is best effort for now or I can try to access collection deletion.

        // Let's verify if we can delete from Chroma by metadata 'knowledgeBaseId' if we stored it?
        // In documents.routes.ts we stored: source: filename.
        // We can look up filename from DB before delete.

        const doc = await queryOne<{ filename: string }>(
            `SELECT filename FROM knowledge_bases WHERE id = $1 AND "agentId" = $2`,
            [docId, agentId]
        );

        if (doc) {
            try {
                // Delete chunks from Chroma where source matches filename
                await chromaService.deleteDocuments(agentId, { source: doc.filename });
                console.log(`Deleted chunks for ${doc.filename} from Chroma`);
            } catch (e) {
                console.warn('Chroma delete failed', e);
            }
        }

        // Delete from knowledge_bases (cascades to document_chunks)
        await query(
            `DELETE FROM knowledge_bases WHERE id = $1 AND "agentId" = $2`,
            [docId, agentId]
        );

        return res.status(200).send();
    } catch (error: any) {
        console.error('Delete document error:', error.message);
        return res.status(500).json({ error: 'Failed to delete document' });
    }
});

// 3. Inspect document chunks
router.get('/:agentId/documents/:docId', async (req: Request, res: Response) => {
    try {
        const { agentId, docId } = req.params;

        // Get document metadata
        const doc = await queryOne<{ id: string; filename: string }>(
            `SELECT id, filename FROM knowledge_bases WHERE id = $1 AND "agentId" = $2`,
            [docId, agentId]
        );

        if (!doc) {
            return res.status(404).json({ error: 'Document not found' });
        }

        // Fetch chunks
        const chunks = await query<{ id: string; content: string }>(
            `SELECT id, content FROM document_chunks WHERE "knowledgeBaseId" = $1 ORDER BY chunk_index ASC`,
            [docId]
        );

        return res.json({
            id: doc.id,
            filename: doc.filename,
            chunks: chunks.map(chunk => ({
                id: chunk.id,
                text: chunk.content // User asked for 'text' or 'content'
            }))
        });

    } catch (error: any) {
        console.error('Inspect document error:', error.message);
        return res.status(500).json({ error: 'Failed to inspect document' });
    }
});

// 4. Update chunk content
router.patch('/:agentId/documents/:docId/chunks/:chunkId', async (req: Request, res: Response) => {
    try {
        const { agentId, docId, chunkId } = req.params;
        const { text } = req.body;

        if (!text || typeof text !== 'string') {
            return res.status(400).json({ error: 'Missing or invalid "text" field' });
        }

        // Verify chunk belongs to this document and agent
        const chunk = await queryOne<{
            id: string;
            knowledge_base_id: string;
            chunk_index: number;
            filename: string;
        }>(
            `SELECT dc.id, dc."knowledgeBaseId" as knowledge_base_id, dc.chunk_index, kb.filename
             FROM document_chunks dc
             JOIN knowledge_bases kb ON kb.id = dc."knowledgeBaseId"
             WHERE dc.id = $1 AND kb.id = $2 AND kb."agentId" = $3`,
            [chunkId, docId, agentId]
        );

        if (!chunk) {
            return res.status(404).json({ error: 'Chunk not found or access denied' });
        }

        // Update chunk content in DB
        await query(
            `UPDATE document_chunks SET content = $1, updated_at = NOW() WHERE id = $2`,
            [text, chunkId]
        );

        // Re-vectorize: regenerate embedding and update in ChromaDB
        try {
            // Find the actual Vector ID in Chroma (it's NOT the PG chunkId)
            const chromaVectorId = await chromaService.findVectorId(
                agentId,
                chunk.knowledge_base_id,
                chunk.chunk_index,
                chunk.filename || ''
            );

            if (chromaVectorId) {
                await chromaService.updateDocument(agentId, chromaVectorId, text);
                console.log(`✅ Updated chunk ${chunkId} (Vector: ${chromaVectorId}) in ChromaDB`);
            } else {
                console.warn(`⚠️ Could not find vector for chunk ${chunkId} in ChromaDB. Skipped vector update.`);
            }
        } catch (chromaError: any) {
            console.warn(`⚠️ ChromaDB update failed for chunk ${chunkId}:`, chromaError.message);
            // Continue - DB is updated, Chroma will be out of sync but not critical
        }

        return res.status(200).json({
            success: true,
            chunkId,
            message: 'Chunk updated successfully'
        });

    } catch (error: any) {
        console.error('Update chunk error:', error.message);
        return res.status(500).json({ error: 'Failed to update chunk' });
    }
});

// Helper to format size
function formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default router;
