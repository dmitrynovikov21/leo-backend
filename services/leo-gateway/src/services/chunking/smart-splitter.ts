/**
 * Smart Text Splitter
 * Splits text into semantically coherent chunks preserving sentence boundaries
 */

import { tokenizeSentences, tokenizeParagraphs } from './sentence-tokenizer';

export interface TextChunk {
    index: number;
    text: string;
    sentenceCount: number;
}

export interface SmartSplitterOptions {
    maxChunkSize?: number;      // Max characters per chunk (default: 800)
    overlapSentences?: number;  // Number of sentences to overlap (default: 1)
    minChunkSize?: number;      // Min characters for a chunk (default: 100)
}

const DEFAULT_OPTIONS: Required<SmartSplitterOptions> = {
    maxChunkSize: 800,
    overlapSentences: 1,
    minChunkSize: 100,
};

/**
 * Split a very long sentence that exceeds maxChunkSize
 * Uses fallback delimiters: semicolon, comma, space
 */
function splitLongSentence(sentence: string, maxSize: number): string[] {
    if (sentence.length <= maxSize) {
        return [sentence];
    }

    const fallbackSeparators = ['; ', ', ', ' '];

    for (const sep of fallbackSeparators) {
        const parts = sentence.split(sep);
        if (parts.length > 1) {
            const result: string[] = [];
            let current = '';

            for (const part of parts) {
                const candidate = current ? current + sep + part : part;

                if (candidate.length <= maxSize) {
                    current = candidate;
                } else {
                    if (current) {
                        result.push(current);
                    }
                    // If single part is still too big, recursively split
                    if (part.length > maxSize) {
                        result.push(...splitLongSentence(part, maxSize));
                        current = '';
                    } else {
                        current = part;
                    }
                }
            }

            if (current) {
                result.push(current);
            }

            return result;
        }
    }

    // Last resort: split by fixed size (but this shouldn't happen often)
    const result: string[] = [];
    for (let i = 0; i < sentence.length; i += maxSize) {
        result.push(sentence.slice(i, i + maxSize));
    }
    return result;
}

/**
 * Smart split text into chunks
 * Preserves sentence boundaries and paragraph structure
 */
export function smartSplitText(
    text: string,
    options: SmartSplitterOptions = {}
): TextChunk[] {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const { maxChunkSize, overlapSentences, minChunkSize } = opts;

    if (!text || text.trim().length === 0) {
        return [];
    }

    // Step 1: Split into paragraphs
    const paragraphs = tokenizeParagraphs(text);

    // Step 2: Tokenize each paragraph into sentences
    const allSentences: { text: string; paragraphBreak: boolean }[] = [];

    for (let i = 0; i < paragraphs.length; i++) {
        const sentences = tokenizeSentences(paragraphs[i]);

        for (let j = 0; j < sentences.length; j++) {
            const isLastInParagraph = j === sentences.length - 1 && i < paragraphs.length - 1;
            allSentences.push({
                text: sentences[j],
                paragraphBreak: isLastInParagraph,
            });
        }
    }

    if (allSentences.length === 0) {
        return [{
            index: 0,
            text: text.trim(),
            sentenceCount: 1,
        }];
    }

    // Step 3: Group sentences into chunks
    const chunks: TextChunk[] = [];
    let currentSentences: string[] = [];
    let currentLength = 0;
    let chunkIndex = 0;

    for (let i = 0; i < allSentences.length; i++) {
        const { text: sentence, paragraphBreak } = allSentences[i];

        // Handle very long sentences
        const sentenceParts = splitLongSentence(sentence, maxChunkSize);

        for (const part of sentenceParts) {
            const newLength = currentLength + part.length + (currentSentences.length > 0 ? 1 : 0);

            // Check if adding this part would exceed limit
            if (currentSentences.length > 0 && newLength > maxChunkSize) {
                // Save current chunk
                chunks.push({
                    index: chunkIndex++,
                    text: currentSentences.join(' ').trim(),
                    sentenceCount: currentSentences.length,
                });

                // Start new chunk with overlap
                if (overlapSentences > 0 && currentSentences.length > 0) {
                    const overlapCount = Math.min(overlapSentences, currentSentences.length);
                    currentSentences = currentSentences.slice(-overlapCount);
                    currentLength = currentSentences.join(' ').length;
                } else {
                    currentSentences = [];
                    currentLength = 0;
                }
            }

            currentSentences.push(part);
            currentLength += part.length + (currentSentences.length > 1 ? 1 : 0);
        }

        // If paragraph break and chunk is reasonably sized, consider ending here
        if (paragraphBreak && currentLength >= minChunkSize) {
            chunks.push({
                index: chunkIndex++,
                text: currentSentences.join(' ').trim(),
                sentenceCount: currentSentences.length,
            });

            // Start fresh (or with overlap)
            if (overlapSentences > 0 && currentSentences.length > 0) {
                const overlapCount = Math.min(overlapSentences, currentSentences.length);
                currentSentences = currentSentences.slice(-overlapCount);
                currentLength = currentSentences.join(' ').length;
            } else {
                currentSentences = [];
                currentLength = 0;
            }
        }
    }

    // Don't forget the last chunk
    if (currentSentences.length > 0) {
        const lastText = currentSentences.join(' ').trim();

        // If last chunk is very small, merge with previous if possible
        if (lastText.length < minChunkSize && chunks.length > 0) {
            const prevChunk = chunks[chunks.length - 1];
            const combined = prevChunk.text + ' ' + lastText;

            if (combined.length <= maxChunkSize * 1.2) {
                // Allow slight overflow for better coherence
                chunks[chunks.length - 1] = {
                    ...prevChunk,
                    text: combined,
                    sentenceCount: prevChunk.sentenceCount + currentSentences.length,
                };
            } else {
                chunks.push({
                    index: chunkIndex,
                    text: lastText,
                    sentenceCount: currentSentences.length,
                });
            }
        } else {
            chunks.push({
                index: chunkIndex,
                text: lastText,
                sentenceCount: currentSentences.length,
            });
        }
    }

    return chunks;
}
