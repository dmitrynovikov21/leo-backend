import { Router, Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { parseDocument } from '../services/parser.service';
import { chromaService } from '../services/chroma.service';
import { splitText, TextChunk } from '../services/text-splitter.service';
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
        ];

        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Unsupported file type: ${file.mimetype}`));
        }
    },
});

// ===== NEW API: Parse document to chunks (no vectorization) =====
router.post('/parse', upload.single('file'), async (req: Request, res: Response) => {
    try {
        const file = req.file;
        const chunkSize = parseInt(req.body.chunkSize) || 1000;
        const chunkOverlap = parseInt(req.body.chunkOverlap) || 200;

        if (!file) {
            return res.status(400).json({ error: 'No file provided' });
        }

        console.log(`📄 Parsing document: ${file.originalname}`);

        // Parse document to text
        const parsed = await parseDocument(file.buffer, file.originalname, file.mimetype);

        // Split text into chunks using RecursiveCharacterTextSplitter logic
        const chunks = splitText(parsed.text, { chunkSize, chunkOverlap });

        console.log(`📊 Split into ${chunks.length} chunks`);

        return res.json({
            success: true,
            filename: file.originalname,
            mimeType: file.mimetype,
            fileSize: file.size,
            totalChunks: chunks.length,
            chunkSize,
            chunkOverlap,
            chunks,
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

        const { agentId, userId, filename, chunks } = parsed.data;

        console.log(`🔢 Vectorizing ${chunks.length} chunks for agent ${agentId}`);

        // Convert to DocumentChunk format for Chroma
        const documentChunks = chunks.map((chunk, i) => ({
            id: `${agentId}_${filename}_${chunk.index}_${Date.now()}`,
            content: chunk.text,
            metadata: {
                source: filename,
                chunkIndex: chunk.index,
                mimeType: 'text/plain',
                agentId,
                userId,
            },
        }));

        // Add to Chroma
        await chromaService.addDocuments(agentId, documentChunks);

        console.log(`✅ Added ${chunks.length} vectors to Chroma collection agent_${agentId}`);

        // Save to knowledge_bases table
        // Note: gen_random_uuid() might not work if pgcrypto is not enabled. 
        // Using string interpolation for values is unsafe, but here we use parameterized queries.
        // We'll trust DB has gen_random_uuid() or similar, if not we might catch error.
        // To be safe regarding ID generation, better generate UUID in code.
        const kbId = crypto.randomUUID();

        await query(
            `INSERT INTO knowledge_bases (id, "agentId", filename, "fileUrl", "fileSize", "mimeType", created_at, updated_at, status)
             VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), 'VECTORIZED')`,
            [kbId, agentId, filename, `chroma://agent_${agentId}`, 0, 'application/chunks'] // fileSize 0 for now as we don't have original size here easily
        );

        return res.json({
            success: true,
            agentId,
            filename,
            chunksVectorized: chunks.length,
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

export default router;
