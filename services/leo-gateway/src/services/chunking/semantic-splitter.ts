/**
 * Semantic Splitter
 * Uses semantic-chunking package (ONNX-based, local embeddings)
 * to split text by meaning boundaries rather than fixed character limits
 */

import { TextChunk } from './smart-splitter';

interface SemanticSplitterOptions {
    maxTokenSize?: number;
    similarityThreshold?: number;
}

const DEFAULT_OPTIONS: Required<SemanticSplitterOptions> = {
    maxTokenSize: 500,
    similarityThreshold: 0.5,
};

/**
 * Split text into semantically coherent chunks using local ONNX embeddings
 * Uses Xenova/all-MiniLM-L6-v2 model (free, runs locally)
 */
export async function semanticSplitText(
    text: string,
    options: SemanticSplitterOptions = {}
): Promise<TextChunk[]> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    if (!text || text.trim().length === 0) {
        return [];
    }

    const { chunkit } = await import('semantic-chunking');

    const result = await chunkit(text, {
        maxTokenSize: opts.maxTokenSize,
        similarityThreshold: opts.similarityThreshold,
        onnxEmbeddingModel: 'Xenova/all-MiniLM-L6-v2',
        onnxEmbeddingModelQuantized: true,
        combineChunks: true,
        combineChunksSimilarityThreshold: 0.6,
    });

    // Convert to TextChunk[] format matching smart-splitter output
    const chunks: TextChunk[] = result.map((chunk: any, index: number) => {
        const chunkText = typeof chunk === 'string' ? chunk : chunk.text || chunk.content || String(chunk);
        // Count sentences roughly by splitting on sentence-ending punctuation
        const sentenceCount = (chunkText.match(/[.!?]+\s/g) || []).length + 1;

        return {
            index,
            text: chunkText.trim(),
            sentenceCount,
        };
    });

    // Filter out empty chunks
    return chunks.filter(c => c.text.length > 0);
}
