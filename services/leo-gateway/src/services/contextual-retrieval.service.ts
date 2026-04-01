/**
 * Contextual Retrieval Service
 * Enriches document chunks with LLM-generated context for better RAG
 * Based on Anthropic's "Contextual Retrieval" approach
 */

import { litellmService } from './litellm.service';
import { query } from '../db';

const ENRICHMENT_MODEL = 'claude-sonnet-4-6';
const MAX_DOC_CHARS = 48000; // Truncate docs longer than this for context window safety
const ENRICHMENT_TEMPERATURE = 0;
const ENRICHMENT_MAX_TOKENS = 300;

// Conflict markers to scan in LLM response
const CONFLICT_MARKERS = [
    'противоречит',
    'обновляет',
    'заменяет',
    'ранее было',
    'изменено',
    'пересмотрено',
    'старые значения',
    'вместо',
    'актуальные данные',
];

const ENRICHMENT_PROMPT = `Ты помогаешь обогащать чанки документа контекстом для поисковой системы.

Дан полный документ и один чанк из него. Твоя задача — написать краткий контекст (2-4 предложения), который:
1. Объясняет, к какой части документа относится этот чанк
2. Описывает основную тему/суть чанка в контексте всего документа
3. Упоминает ключевые сущности (имена, даты, числа), которые важны для поиска

Если чанк содержит информацию, которая ПРОТИВОРЕЧИТ или ОБНОВЛЯЕТ данные из других частей документа, явно укажи это — используй слова: "противоречит", "обновляет", "заменяет", "ранее было".

Ответь ТОЛЬКО контекстом, без пояснений и маркировки.`;

export interface EnrichmentResult {
    context: string | null;
    hasConflictMarker: boolean;
    tokensUsed: number;
}

export interface EnrichmentStats {
    chunksEnriched: number;
    chunksFailed: number;
    totalTokensUsed: number;
    conflictsFound: number;
    conflictChunkIndices: number[];
}

/**
 * Enrich a single chunk with contextual information
 */
export async function enrichSingleChunk(
    fullDocText: string,
    chunkText: string,
    chunkIndex: number
): Promise<EnrichmentResult> {
    try {
        // Truncate document if too long
        const docContext = fullDocText.length > MAX_DOC_CHARS
            ? fullDocText.slice(0, MAX_DOC_CHARS) + '\n\n[... документ обрезан ...]'
            : fullDocText;

        const response = await litellmService.chatCompletion({
            model: ENRICHMENT_MODEL,
            messages: [
                { role: 'system', content: ENRICHMENT_PROMPT },
                {
                    role: 'user',
                    content: `<document>\n${docContext}\n</document>\n\n<chunk index="${chunkIndex}">\n${chunkText}\n</chunk>`,
                },
            ],
            temperature: ENRICHMENT_TEMPERATURE,
            max_tokens: ENRICHMENT_MAX_TOKENS,
            requestType: 'CONTEXTUAL_ENRICHMENT',
        });

        const context = response.choices[0]?.message?.content?.trim() || null;
        const tokensUsed = response.usage?.total_tokens || 0;

        // Check for conflict markers
        const hasConflictMarker = context
            ? CONFLICT_MARKERS.some(marker => context.toLowerCase().includes(marker))
            : false;

        return { context, hasConflictMarker, tokensUsed };
    } catch (error: any) {
        console.warn(`[Enrichment] Failed for chunk ${chunkIndex}:`, error.message);
        return { context: null, hasConflictMarker: false, tokensUsed: 0 };
    }
}

/**
 * Enrich all chunks with context in batches
 */
export async function enrichChunksWithContext(
    fullDocText: string,
    chunks: { index: number; text: string }[],
    batchSize: number = 5,
    delayMs: number = 1000
): Promise<{ results: EnrichmentResult[]; stats: EnrichmentStats }> {
    const results: EnrichmentResult[] = [];
    const stats: EnrichmentStats = {
        chunksEnriched: 0,
        chunksFailed: 0,
        totalTokensUsed: 0,
        conflictsFound: 0,
        conflictChunkIndices: [],
    };

    console.log(`[Enrichment] Starting enrichment of ${chunks.length} chunks (batch size: ${batchSize})`);

    for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);

        const batchResults = await Promise.all(
            batch.map(chunk => enrichSingleChunk(fullDocText, chunk.text, chunk.index))
        );

        for (let j = 0; j < batchResults.length; j++) {
            const result = batchResults[j];
            results.push(result);

            if (result.context) {
                stats.chunksEnriched++;
            } else {
                stats.chunksFailed++;
            }

            stats.totalTokensUsed += result.tokensUsed;

            if (result.hasConflictMarker) {
                stats.conflictsFound++;
                stats.conflictChunkIndices.push(batch[j].index);
            }
        }

        // Delay between batches to avoid rate limits
        if (i + batchSize < chunks.length) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    console.log(`[Enrichment] Done: ${stats.chunksEnriched} enriched, ${stats.chunksFailed} failed, ${stats.totalTokensUsed} tokens, ${stats.conflictsFound} conflicts`);

    return { results, stats };
}

/**
 * Re-enrich a single chunk after edit
 * Reconstructs full document from sibling chunks
 */
export async function reEnrichSingleChunk(
    knowledgeBaseId: string,
    chunkIndex: number,
    newText: string
): Promise<EnrichmentResult> {
    try {
        // Get all sibling chunks to reconstruct the document
        const siblingChunks = await query<{ content: string; chunk_index: number }>(
            `SELECT content, chunk_index FROM document_chunks
             WHERE "knowledgeBaseId" = $1
             ORDER BY chunk_index ASC`,
            [knowledgeBaseId]
        );

        // Reconstruct full document, replacing the edited chunk
        const fullDocParts = siblingChunks.map(c =>
            c.chunk_index === chunkIndex ? newText : c.content
        );
        const fullDocText = fullDocParts.join('\n\n');

        return await enrichSingleChunk(fullDocText, newText, chunkIndex);
    } catch (error: any) {
        console.warn(`[Enrichment] Re-enrichment failed for chunk ${chunkIndex}:`, error.message);
        return { context: null, hasConflictMarker: false, tokensUsed: 0 };
    }
}

/**
 * Build enriched text for Chroma storage
 * Format: [CONTEXT]: {context}\n\n{original text}
 */
export function buildEnrichedText(originalText: string, context: string | null): string {
    if (!context) return originalText;
    return `[CONTEXT]: ${context}\n\n${originalText}`;
}

/**
 * Strip [CONTEXT] prefix from text retrieved from Chroma
 */
export function stripContextPrefix(text: string): string {
    const prefix = '[CONTEXT]: ';
    if (!text.startsWith(prefix)) return text;

    // Find the double newline that separates context from original text
    const separatorIndex = text.indexOf('\n\n');
    if (separatorIndex === -1) return text;

    return text.slice(separatorIndex + 2);
}
