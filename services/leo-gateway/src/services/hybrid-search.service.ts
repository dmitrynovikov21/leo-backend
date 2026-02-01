/**
 * Hybrid Search Service
 * Combines Chroma vector search with PostgreSQL FTS for better recall
 */

import { chromaService } from './chroma.service';
import { ftsService } from './fts.service';

export interface HybridSearchResult {
    id: string;
    content: string;
    score: number;
    source: 'vector' | 'fts' | 'both';
    metadata: Record<string, any>;
}

class HybridSearchService {
    /**
     * Hybrid search combining vector (Chroma) and keyword (FTS) results
     * Uses Reciprocal Rank Fusion (RRF) for combining scores
     */
    async search(
        agentId: string,
        query: string,
        limit: number = 5
    ): Promise<HybridSearchResult[]> {
        // Run both searches in parallel
        const [vectorResults, ftsResults] = await Promise.all([
            chromaService.searchDocuments(agentId, query, limit).catch(() => []),
            ftsService.searchDocuments(agentId, query, limit).catch(() => []),
        ]);

        // Create a map to combine results
        const resultMap = new Map<string, HybridSearchResult>();

        // Add vector results with RRF scoring
        vectorResults.forEach((result, rank) => {
            const rrfScore = 1 / (60 + rank + 1); // k=60 is common for RRF
            const existing = resultMap.get(result.content);

            if (existing) {
                existing.score += rrfScore;
                existing.source = 'both';
            } else {
                resultMap.set(result.content, {
                    id: `vector_${rank}`,
                    content: result.content,
                    score: rrfScore,
                    source: 'vector',
                    metadata: result.metadata,
                });
            }
        });

        // Add FTS results with RRF scoring
        ftsResults.forEach((result, rank) => {
            const rrfScore = 1 / (60 + rank + 1);
            const existing = resultMap.get(result.content);

            if (existing) {
                existing.score += rrfScore;
                existing.source = 'both';
                // Merge metadata if needed, or keep existing
                existing.metadata = { ...existing.metadata, knowledgeBaseId: result.knowledgeBaseId };
            } else {
                resultMap.set(result.content, {
                    id: result.id,
                    content: result.content,
                    score: rrfScore,
                    source: 'fts',
                    metadata: { knowledgeBaseId: result.knowledgeBaseId },
                });
            }
        });

        // Sort by combined score and return top results
        return Array.from(resultMap.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    /**
     * Search with fallback - uses hybrid if FTS available, otherwise just vector
     */
    async searchWithFallback(
        agentId: string,
        query: string,
        limit: number = 5
    ): Promise<{ content: string; source: string; metadata?: any }[]> {
        const ftsAvailable = await ftsService.isAvailable();

        if (ftsAvailable) {
            const results = await this.search(agentId, query, limit);
            return results.map(r => ({
                content: r.content,
                source: r.source,
                metadata: r.metadata,
            }));
        } else {
            // Fallback to vector-only search
            const results = await chromaService.searchDocuments(agentId, query, limit);
            return results.map(r => ({
                content: r.content,
                source: 'vector',
                metadata: r.metadata,
            }));
        }
    }
}

export const hybridSearchService = new HybridSearchService();
