/**
 * FTS Service - PostgreSQL Full-Text Search
 * Provides keyword-based search (similar to BM25) using tsvector/tsquery
 */

import { query } from '../db';

export interface FtsSearchResult {
    id: string;
    content: string;
    rank: number;
    knowledgeBaseId: string;
}

class FtsService {
    /**
     * Search documents using PostgreSQL Full-Text Search
     */
    async searchDocuments(
        agentId: string,
        queryText: string,
        limit: number = 5
    ): Promise<FtsSearchResult[]> {
        // Get knowledge base IDs for this agent
        const results = await query<{
            id: string;
            content: string;
            rank: number;
            knowledgeBaseId: string;
        }>(
            `SELECT 
                dc.id,
                dc.content,
                ts_rank(dc.search_vector, plainto_tsquery('russian', $2)) as rank,
                dc."knowledgeBaseId"
             FROM document_chunks dc
             JOIN knowledge_bases kb ON dc."knowledgeBaseId" = kb.id
             WHERE kb."agentId" = $1
               AND dc.search_vector @@ plainto_tsquery('russian', $2)
             ORDER BY rank DESC
             LIMIT $3`,
            [agentId, queryText, limit]
        );

        return results.map(r => ({
            id: r.id,
            content: r.content,
            rank: r.rank,
            knowledgeBaseId: r.knowledgeBaseId,
        }));
    }

    /**
     * Check if FTS is available (column exists)
     */
    async isAvailable(): Promise<boolean> {
        try {
            const result = await query(
                `SELECT column_name FROM information_schema.columns 
                 WHERE table_name = 'document_chunks' AND column_name = 'search_vector'`
            );
            return result.length > 0;
        } catch {
            return false;
        }
    }
}

export const ftsService = new FtsService();
