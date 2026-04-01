import { config } from '../config';
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { parseDocument } from '../services/parser.service';
import { chromaService } from '../services/chroma.service';
import { smartSplitText, semanticSplitText } from '../services/chunking';
import { query } from '../db';
import crypto from 'crypto';
import {
    calculateFileCharge,
    checkPuBalance,
    deductPuBalance,
    saveFileProcessingCache,
} from '../services/pu-charging.service';
import {
    enrichChunksWithContext,
    buildEnrichedText,
} from '../services/contextual-retrieval.service';

const router = Router();

// Fix filename encoding: busboy decodes Content-Disposition filenames as Latin-1,
// but browsers send UTF-8. Re-encode as Latin-1 bytes and decode as UTF-8.
function fixFilename(name: string): string {
    try {
        const bytes = Buffer.from(name, 'latin1');
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (decoded !== name) return decoded;
    } catch { /* already valid UTF-8 */ }
    return name;
}

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB max
    },
    fileFilter: (req, file, cb) => {
        // Fix Cyrillic/non-ASCII filename encoding from busboy
        file.originalname = fixFilename(file.originalname);
        const allowedMimes = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            'text/plain',
            'text/markdown',
            'text/x-markdown',
            // CSV
            'text/csv',
            'application/csv',
            // JSON
            'application/json',
            // HTML
            'text/html',
            // Presentations
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/vnd.ms-powerpoint',
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
        const maxChunkSize = parseInt(req.body.chunkSize) || 4000;
        const smartOnly = req.query.smartOnly === 'true' || req.body.smartOnly === 'true';

        if (!file) {
            return res.status(400).json({ error: 'No file provided' });
        }

        console.log(`📄 Parsing document: ${file.originalname}`);

        // Parse document to text
        const parsed = await parseDocument(file.buffer, file.originalname, file.mimetype);
        const fullText = parsed.text;

        let chunks;
        let method = 'smart';

        // Try semantic splitting first (unless smartOnly is requested)
        if (!smartOnly) {
            try {
                chunks = await semanticSplitText(fullText, { maxTokenSize: 500 });
                method = 'semantic';
                console.log(`🧠 Semantic split into ${chunks.length} chunks`);
            } catch (semErr: any) {
                console.warn(`⚠️ Semantic chunking failed, falling back to smart: ${semErr.message}`);
            }
        }

        // Fallback to smart split
        if (!chunks || chunks.length === 0) {
            chunks = smartSplitText(fullText, { maxChunkSize });
            method = 'smart';
            console.log(`📊 Smart split into ${chunks.length} chunks`);
        }

        return res.json({
            success: true,
            filename: file.originalname,
            mimeType: file.mimetype,
            fileSize: file.size,
            totalChunks: chunks.length,
            method,
            maxChunkSize,
            fullText,
            chunks: chunks.map(c => ({
                index: c.index,
                text: c.text,
                sentenceCount: c.sentenceCount,
            })),
        });
    } catch (error: any) {
        console.error('Ошибка парсинга документа:', error.message);
        return res.status(500).json({
            error: error.message || 'Не удалось обработать документ',
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
            ...(config.isDev && { message: error.message }),
        });
    }
});

// ===== NEW API: Vectorize chunks and store in Chroma with PU Charging =====
router.post('/vectorize', async (req: Request, res: Response) => {
    try {
        const schema = z.object({
            agentId: z.string(),
            userId: z.string(),
            filename: z.string(),
            fileSize: z.number().optional().default(0),
            mimeType: z.string().optional().default('application/octet-stream'),
            fullText: z.string().optional().default(''),
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

        const { agentId, userId, filename, fileSize, mimeType, fullText, chunks } = parsed.data;

        if (chunks.length === 0) {
            console.warn(`⚠️ No chunks to vectorize for ${filename} (agent ${agentId}). Skipping.`);
            return res.status(400).json({
                error: 'No chunks to vectorize',
                message: 'Document parsing produced 0 chunks. The file may be empty or unsupported.',
            });
        }

        console.log(`🔢 Vectorizing ${chunks.length} chunks for agent ${agentId}`);

        // ===== NEW: Smart File Charging =====
        console.log(`💰 [PU Charging] Calculating charge for ${filename}...`);

        // 1. Calculate charge
        const chargeInfo = await calculateFileCharge(agentId, filename, chunks);
        console.log(`💰 [PU Charging] Charge calculated: ${chargeInfo.puCost.toFixed(4)} PU (${chargeInfo.reason})`);

        // 2. Check user balance
        const balanceInfo = await checkPuBalance(userId, chargeInfo.puCost);

        if (!balanceInfo.hasBalance) {
            console.warn(`⚠️ [PU Charging] Insufficient balance for user ${userId}`);
            return res.status(402).json({
                error: 'Insufficient PU balance',
                required: chargeInfo.puCost,
                current: balanceInfo.currentBalance,
                limit: balanceInfo.limit,
            });
        }

        console.log(`✅ [PU Charging] Balance check passed for ${userId}`);

        let finalFileSize = fileSize;
        let finalMimeType = mimeType;

        // 1. Check if document already exists (exclude PENDING records created by the leo app)
        const existingDocs = await query<{ id: string; fileSize: number; mimeType: string }>(
            `SELECT id, "fileSize", "mimeType" FROM knowledge_bases WHERE "agentId" = $1 AND filename = $2 AND status != 'PENDING'`,
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

            // Delete from DB (cascades to chunks) — only non-PENDING records
            await query(
                `DELETE FROM knowledge_bases WHERE "agentId" = $1 AND filename = $2 AND status != 'PENDING'`,
                [agentId, filename]
            );
        }

        // Save to knowledge_bases table
        const kbId = crypto.randomUUID();

        await query(
            `INSERT INTO knowledge_bases (id, "agentId", filename, "fileUrl", "fileSize", "mimeType", created_at, updated_at, status)
             VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), 'PENDING')`,
            [kbId, agentId, filename, `chroma://agent_${agentId}`, finalFileSize, finalMimeType]
        );

        // ===== Contextual Enrichment =====
        let enrichmentStats = { chunksEnriched: 0, chunksFailed: 0, totalTokensUsed: 0, conflictsFound: 0, conflictChunkIndices: [] as number[] };
        let enrichmentResults: { context: string | null; hasConflictMarker: boolean; tokensUsed: number }[] = [];

        if (fullText && fullText.length > 0) {
            try {
                console.log(`🧠 [Enrichment] Starting contextual enrichment for ${chunks.length} chunks`);
                const enrichment = await enrichChunksWithContext(fullText, chunks);
                enrichmentResults = enrichment.results;
                enrichmentStats = enrichment.stats;
            } catch (enrichErr: any) {
                console.warn(`⚠️ [Enrichment] Failed, continuing without enrichment:`, enrichErr.message);
                enrichmentResults = chunks.map(() => ({ context: null, hasConflictMarker: false, tokensUsed: 0 }));
            }
        } else {
            enrichmentResults = chunks.map(() => ({ context: null, hasConflictMarker: false, tokensUsed: 0 }));
        }

        // Sanitize: remove null bytes (0x00) that PostgreSQL TEXT columns reject
        const sanitize = (s: string | null) => s ? s.replace(/\0/g, '') : s;

        // Convert to DocumentChunk format for Chroma (with enriched text)
        const documentChunks = chunks.map((chunk, i) => {
            const enrichedContext = enrichmentResults[i]?.context || null;
            return {
                id: `${agentId}_${filename}_${chunk.index}_${Date.now()}`,
                content: sanitize(buildEnrichedText(chunk.text, enrichedContext)) || '',
                metadata: {
                    source: filename,
                    chunkIndex: chunk.index,
                    mimeType: finalMimeType,
                    agentId,
                    userId,
                    knowledgeBaseId: kbId,
                },
            };
        });

        // Add to Chroma (enriched text for better semantic search)
        await chromaService.addDocuments(agentId, documentChunks);

        console.log(`✅ Added ${chunks.length} vectors to Chroma collection agent_${agentId}`);

        // Save chunks to document_chunks table (original text + context separately)
        if (chunks.length > 0) {
            const insertPromises = chunks.map((chunk, i) => {
                const context = enrichmentResults[i]?.context || null;
                return query(
                    `INSERT INTO document_chunks (id, "knowledgeBaseId", content, context, chunk_index, search_vector, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5, to_tsvector('simple', $3), NOW(), NOW())`,
                    [crypto.randomUUID(), kbId, sanitize(chunk.text), sanitize(context), chunk.index]
                );
            });

            await Promise.all(insertPromises);
        }

        // Mark as VECTORIZED after successful Chroma + DB insert
        await query(
            `UPDATE knowledge_bases SET status = 'VECTORIZED', updated_at = NOW() WHERE id = $1`,
            [kbId]
        );

        // Conflict detection is handled by the explicit audit endpoint (/kb/audit)
        // Enrichment markers are logged but NOT saved as conflicts — they produce
        // false positives because enrichment only sees the current document, not cross-document contradictions
        if (enrichmentStats.conflictsFound > 0) {
            console.log(`ℹ️ [Enrichment] ${enrichmentStats.conflictsFound} potential conflict markers detected in "${filename}" — skipping auto-creation, use /kb/audit for cross-document analysis`);
        }

        // ===== Deduct PU after successful vectorization =====
        // Add enrichment token cost to PU charge
        const enrichmentPuCost = enrichmentStats.totalTokensUsed / 1000; // rough PU estimate
        const totalPuCost = chargeInfo.puCost + enrichmentPuCost;

        const deductSuccess = await deductPuBalance(userId, totalPuCost, {
            source: 'KB_UPLOAD',
            filename,
            agentId,
            chargeReason: chargeInfo.reason,
            enrichmentTokens: enrichmentStats.totalTokensUsed,
        });

        if (!deductSuccess) {
            console.error(`❌ [PU Charging] Failed to deduct PU, but vectorization succeeded. Rolling back...`);
            // Optional: Rollback vectorization if PU deduction fails
            // For now, log the issue
        }

        // ===== NEW: Save to file processing cache =====
        const contentHash = crypto
            .createHash('sha256')
            .update(chunks.map(c => c.text).join('\n'))
            .digest('hex');

        await saveFileProcessingCache(
            agentId,
            filename,
            contentHash,
            finalFileSize,
            chunks.length,
            chargeInfo.puCost,
            chargeInfo.chargePercentage
        );

        return res.json({
            success: true,
            agentId,
            filename,
            chunksVectorized: chunks.length,
            knowledgeBaseId: kbId,
            puCharged: totalPuCost,
            chargeReason: chargeInfo.reason,
            chargePercentage: chargeInfo.chargePercentage,
            enrichment: {
                chunksEnriched: enrichmentStats.chunksEnriched,
                chunksFailed: enrichmentStats.chunksFailed,
                tokensUsed: enrichmentStats.totalTokensUsed,
                conflictsFound: enrichmentStats.conflictsFound,
            },
        });
    } catch (error: any) {
        console.error('Vectorize error:', error.message);
        // Try to mark KB record as ERROR if it was created
        try {
            const { agentId, filename } = req.body || {};
            if (agentId && filename) {
                await query(
                    `UPDATE knowledge_bases SET status = 'ERROR', updated_at = NOW() WHERE "agentId" = $1 AND filename = $2 AND status = 'PENDING'`,
                    [agentId, filename]
                );
            }
        } catch (_) { /* best effort */ }
        return res.status(500).json({
            error: 'Failed to vectorize chunks',
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
            ...(config.isDev && { message: error.message }),
        });
    }
});

// Get knowledge base info for agent
router.get('/:agentId/info', async (req: Request, res: Response) => {
    try {
        const { agentId } = req.params;

        const chromaInfo = await chromaService.getCollectionInfo(agentId);

        const knowledgeBases = await query(
            `SELECT id, filename, "fileSize", "mimeType", created_at
       FROM knowledge_bases WHERE "agentId" = $1 ORDER BY created_at DESC`,
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
            ...(config.isDev && { message: error.message }),
        });
    }
});

// Delete agent's knowledge base
router.delete('/:agentId', async (req: Request, res: Response) => {
    try {
        const { agentId } = req.params;

        await chromaService.deleteCollection(agentId);

        await query(
            `DELETE FROM knowledge_bases WHERE "agentId" = $1`,
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
            ...(config.isDev && { message: error.message }),
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
            ...(config.isDev && { message: error.message }),
        });
    }
});

export default router;
