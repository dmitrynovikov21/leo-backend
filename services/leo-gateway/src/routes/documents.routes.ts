import { Router, Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { parseDocument } from '../services/parser.service';
import { chromaService } from '../services/chroma.service';
import { smartSplitText } from '../services/chunking';
import { query } from '../db';

const router = Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB max
    },
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            'text/plain',
            'text/markdown',
            // Images for OCR
            'image/png',
            'image/jpeg',
            'image/jpg',
            'image/webp',
            'image/bmp',
            'image/tiff',
            'image/gif',
        ];

        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Unsupported file type: ${file.mimetype}`));
        }
    },
});

// ===== Smart Parse: Split document into semantic chunks =====
router.post('/parse', upload.single('file'), async (req: Request, res: Response) => {
    try {
        const file = req.file;
        const maxChunkSize = parseInt(req.body.chunkSize) || 2000;

        if (!file) {
            return res.status(400).json({ error: 'No file provided' });
        }

        console.log(`📄 Parsing document: ${file.originalname}`);

        // Parse document to text
        const parsed = await parseDocument(file.buffer, file.originalname, file.mimetype);

        // Smart split: preserves sentence boundaries
        const chunks = smartSplitText(parsed.text, { maxChunkSize });

        console.log(`📊 Smart split into ${chunks.length} chunks`);

        return res.json({
            success: true,
            filename: file.originalname,
            mimeType: file.mimetype,
            fileSize: file.size,
            totalChunks: chunks.length,
            method: 'smart',
            maxChunkSize,
            chunks: chunks.map(c => ({
                index: c.index,
                text: c.text,
                sentenceCount: c.sentenceCount,
            })),
        });
    } catch (error: any) {
        console.error('Document parse error:', error.message);
        return res.status(500).json({
            error: 'Failed to parse document',
            message: error.message,
        });
    }
});

// ===== NEW API: Semantic chunking with LLM =====
router.post('/parse-semantic', upload.single('file'), async (req: Request, res: Response) => {
    try {
        const file = req.file;

        if (!file) {
            return res.status(400).json({ error: 'No file provided' });
        }

        console.log(`🧠 Semantic parsing: ${file.originalname}`);

        // Parse document to text
        const parsed = await parseDocument(file.buffer, file.originalname, file.mimetype);

        // Import dynamically to avoid circular deps
        const { semanticChunking } = await import('../services/semantic-chunker.service');

        // Split using LLM for semantic understanding
        const chunks = await semanticChunking(parsed.text);

        console.log(`🧠 Semantic split into ${chunks.length} chunks`);

        return res.json({
            success: true,
            filename: file.originalname,
            mimeType: file.mimetype,
            fileSize: file.size,
            totalChunks: chunks.length,
            method: 'semantic-llm',
            chunks,
        });
    } catch (error: any) {
        console.error('Semantic parse error:', error.message);
        return res.status(500).json({
            error: 'Failed to parse document semantically',
            message: error.message,
        });
    }
});

// ===== NEW API: Vectorize chunks and store in Chroma =====
router.post('/vectorize', async (req: Request, res: Response) => {
    try {
        const schema = z.object({
            agentId: z.string(),
            userId: z.string(),
            filename: z.string(),
            fileSize: z.number().optional().default(0),
            mimeType: z.string().optional().default('application/octet-stream'),
            chunks: z.array(z.object({
                index: z.number(),
                text: z.string(),
            })),
        });

        const parsed = schema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { agentId, userId, filename, fileSize, mimeType, chunks } = parsed.data;

        console.log(`🔢 Vectorizing ${chunks.length} chunks for agent ${agentId}`);

        let finalFileSize = fileSize;
        let finalMimeType = mimeType;

        // 1. Check if document already exists
        const existingDocs = await query<{ id: string; fileSize: number; mimeType: string }>(
            `SELECT id, "fileSize", "mimeType" FROM knowledge_bases WHERE "agentId" = $1 AND filename = $2`,
            [agentId, filename]
        );

        if (existingDocs.length > 0) {
            const existing = existingDocs[0];
            console.log(`🔄 Document ${filename} exists. Replacing but preserving metadata...`);

            // Preserve existing metadata if valid (user request: new data might be "broken")
            if (existing.fileSize && existing.fileSize > 0) {
                finalFileSize = existing.fileSize;
            }
            if (existing.mimeType) {
                finalMimeType = existing.mimeType;
            }

            // Delete from Chroma
            await chromaService.deleteDocuments(agentId, { source: filename });

            // Delete from DB (cascades to chunks)
            await query(
                `DELETE FROM knowledge_bases WHERE "agentId" = $1 AND filename = $2`,
                [agentId, filename]
            );
        }

        // Save to knowledge_bases table
        const kbId = crypto.randomUUID();

        await query(
            `INSERT INTO knowledge_bases (id, "agentId", filename, "fileUrl", "fileSize", "mimeType", created_at, updated_at, status)
             VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), 'VECTORIZED')`,
            [kbId, agentId, filename, `chroma://agent_${agentId}`, finalFileSize, finalMimeType]
        );

        // Convert to DocumentChunk format for Chroma
        const documentChunks = chunks.map((chunk, i) => ({
            id: `${agentId}_${filename}_${chunk.index}_${Date.now()}`,
            content: chunk.text,
            metadata: {
                source: filename,
                chunkIndex: chunk.index,
                mimeType: finalMimeType,
                agentId,
                userId,
                knowledgeBaseId: kbId,
            },
        }));

        // Add to Chroma
        await chromaService.addDocuments(agentId, documentChunks);

        console.log(`✅ Added ${chunks.length} vectors to Chroma collection agent_${agentId}`);

        // Save chunks to document_chunks table
        // We use a transaction conceptually, but here sequential inserts for simplicity
        if (chunks.length > 0) {
            // Construct generic INSERT for multiple rows or loop
            // For simplicity and safety against SQL inject, we loop or use unnest if supported.
            // Let's use loop for safety and simplicity with existing query helper (it might not support bulk insert easily without specific syntax)

            // Actually, let's just do sequential await for now or Promise.all (faster)
            const insertPromises = chunks.map(chunk =>
                query(
                    `INSERT INTO document_chunks (id, "knowledgeBaseId", content, chunk_index, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, NOW(), NOW())`,
                    [crypto.randomUUID(), kbId, chunk.text, chunk.index]
                )
            );

            await Promise.all(insertPromises);
        }

        return res.json({
            success: true,
            agentId,
            filename,
            chunksVectorized: chunks.length,
            knowledgeBaseId: kbId
        });
    } catch (error: any) {
        console.error('Vectorize error:', error.message);
        return res.status(500).json({
            error: 'Failed to vectorize chunks',
            message: error.message,
        });
    }
});

// ===== LEGACY: Upload and vectorize in one step =====
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
    try {
        const file = req.file;
        const { agentId, userId } = req.body;

        if (!file) {
            return res.status(400).json({ error: 'No file provided' });
        }

        if (!agentId || !userId) {
            return res.status(400).json({ error: 'agentId and userId are required' });
        }

        console.log(`📄 Processing document: ${file.originalname} for agent ${agentId}`);

        // Parse document
        const parsed = await parseDocument(file.buffer, file.originalname, file.mimetype);

        console.log(`📊 Parsed ${parsed.chunks.length} chunks`);

        // Add to Chroma
        await chromaService.addDocuments(agentId, parsed.chunks);

        console.log(`✅ Added to Chroma collection agent_${agentId}`);

        // Save to knowledge_bases table
        await query(
            `INSERT INTO knowledge_bases (id, agent_id, filename, file_url, file_size, mime_type, created_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, NOW())`,
            [agentId, file.originalname, `chroma://agent_${agentId}`, file.size, file.mimetype]
        );

        return res.json({
            success: true,
            filename: file.originalname,
            chunksCount: parsed.chunks.length,
            agentId,
        });
    } catch (error: any) {
        console.error('Document upload error:', error.message);
        return res.status(500).json({
            error: 'Failed to process document',
            message: error.message,
        });
    }
});

// Upload text content directly (for string input)
router.post('/upload-text', async (req: Request, res: Response) => {
    try {
        const schema = z.object({
            agentId: z.string(),
            userId: z.string(),
            content: z.string().min(1),
            filename: z.string().optional().default('text-input.txt'),
        });

        const parsed = schema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { agentId, userId, content, filename } = parsed.data;

        console.log(`📝 Processing text input for agent ${agentId}`);

        // Parse as text
        const buffer = Buffer.from(content, 'utf-8');
        const doc = await parseDocument(buffer, filename, 'text/plain');

        // Add to Chroma
        await chromaService.addDocuments(agentId, doc.chunks);

        console.log(`✅ Added ${doc.chunks.length} chunks to Chroma`);

        return res.json({
            success: true,
            filename,
            chunksCount: doc.chunks.length,
            agentId,
        });
    } catch (error: any) {
        console.error('Text upload error:', error.message);
        return res.status(500).json({
            error: 'Failed to process text',
            message: error.message,
        });
    }
});

// Search documents in agent's knowledge base
router.post('/search', async (req: Request, res: Response) => {
    try {
        const schema = z.object({
            agentId: z.string(),
            query: z.string().min(1),
            limit: z.number().optional().default(3),
        });

        const parsed = schema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { agentId, query: searchQuery, limit } = parsed.data;

        const results = await chromaService.searchDocuments(agentId, searchQuery, limit);

        return res.json({
            agentId,
            query: searchQuery,
            results,
        });
    } catch (error: any) {
        console.error('Document search error:', error.message);
        return res.status(500).json({
            error: 'Failed to search documents',
            message: error.message,
        });
    }
});

// Get knowledge base info for agent
router.get('/:agentId/info', async (req: Request, res: Response) => {
    try {
        const { agentId } = req.params;

        const chromaInfo = await chromaService.getCollectionInfo(agentId);

        const knowledgeBases = await query(
            `SELECT id, filename, file_size, mime_type, created_at 
       FROM knowledge_bases WHERE agent_id = $1 ORDER BY created_at DESC`,
            [agentId]
        );

        return res.json({
            agentId,
            vectorCount: chromaInfo?.count || 0,
            documents: knowledgeBases,
        });
    } catch (error: any) {
        console.error('Get knowledge base info error:', error.message);
        return res.status(500).json({
            error: 'Failed to get knowledge base info',
            message: error.message,
        });
    }
});

// Delete agent's knowledge base
router.delete('/:agentId', async (req: Request, res: Response) => {
    try {
        const { agentId } = req.params;

        await chromaService.deleteCollection(agentId);

        await query(
            `DELETE FROM knowledge_bases WHERE agent_id = $1`,
            [agentId]
        );

        return res.json({
            success: true,
            message: `Knowledge base for agent ${agentId} deleted`,
        });
    } catch (error: any) {
        console.error('Delete knowledge base error:', error.message);
        return res.status(500).json({
            error: 'Failed to delete knowledge base',
            message: error.message,
        });
    }
});

// Delete documents by source (for notes cleanup)
router.post('/delete-by-source', async (req: Request, res: Response) => {
    try {
        const schema = z.object({
            agentId: z.string(),
            source: z.string(),
        });

        const parsed = schema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { agentId, source } = parsed.data;

        await chromaService.deleteDocuments(agentId, { source });

        return res.json({
            success: true,
            message: `Documents with source ${source} deleted for agent ${agentId}`,
        });
    } catch (error: any) {
        console.error('Delete by source error:', error.message);
        return res.status(500).json({
            error: 'Failed to delete documents by source',
            message: error.message,
        });
    }
});

export default router;
