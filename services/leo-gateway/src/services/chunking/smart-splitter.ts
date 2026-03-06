import { tokenizeSentences, tokenizeParagraphs } from './sentence-tokenizer';

export interface TextChunk {
    index: number;
    text: string;
    sentenceCount: number;
}

export interface SmartSplitterOptions {
    maxChunkSize?: number;
    overlapSentences?: number;
    minChunkSize?: number;
    semanticSeparators?: string[];
}

const DEFAULT_OPTIONS: Required<SmartSplitterOptions> = {
    maxChunkSize: 4000,
    overlapSentences: 1,
    minChunkSize: 500,
    semanticSeparators: ['\n\n', '---', '###', '##', '[QUESTION]', '[ANSWER_FOR_CLIENT]', '[KEYWORDS]', '[AI_ACTION]'],
};

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

    const result: string[] = [];
    for (let i = 0; i < sentence.length; i += maxSize) {
        result.push(sentence.slice(i, i + maxSize));
    }
    return result;
}

function splitBySemanticSeparators(text: string, separators: string[]): string[] {
    const sorted = [...separators].sort((a, b) => b.length - a.length);

    const pattern = sorted
        .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
    const regex = new RegExp(`(${pattern})`, 'g');

    const parts = text.split(regex);

    const blocks: string[] = [];
    let current = '';

    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;

        const isSeparator = sorted.some(s => trimmed === s.trim());

        if (isSeparator) {
            if (current.trim()) {
                blocks.push(current.trim());
            }
            current = '';
        } else {
            current += (current ? '\n\n' : '') + part;
        }
    }

    if (current.trim()) {
        blocks.push(current.trim());
    }

    return blocks;
}

function mergeSmallBlocks(blocks: string[], minSize: number, maxSize: number): string[] {
    if (blocks.length <= 1) return blocks;

    const result: string[] = [];
    let current = blocks[0];

    for (let i = 1; i < blocks.length; i++) {
        const combined = current + '\n\n' + blocks[i];

        if (current.length < minSize && combined.length <= maxSize) {
            current = combined;
        } else if (blocks[i].length < minSize && combined.length <= maxSize) {
            current = combined;
        } else {
            result.push(current);
            current = blocks[i];
        }
    }

    result.push(current);
    return result;
}

function splitBySentences(text: string, maxChunkSize: number, overlapSentences: number): TextChunk[] {
    const paragraphs = tokenizeParagraphs(text);
    const allSentences: { text: string; paragraphBreak: boolean }[] = [];

    for (let i = 0; i < paragraphs.length; i++) {
        const sentences = tokenizeSentences(paragraphs[i]);
        for (let j = 0; j < sentences.length; j++) {
            const isLastInParagraph = j === sentences.length - 1 && i < paragraphs.length - 1;
            allSentences.push({ text: sentences[j], paragraphBreak: isLastInParagraph });
        }
    }

    if (allSentences.length === 0) {
        return [{ index: 0, text: text.trim(), sentenceCount: 1 }];
    }

    const chunks: TextChunk[] = [];
    let currentSentences: string[] = [];
    let currentLength = 0;
    let chunkIndex = 0;

    for (let i = 0; i < allSentences.length; i++) {
        const { text: sentence, paragraphBreak } = allSentences[i];
        const sentenceParts = splitLongSentence(sentence, maxChunkSize);

        for (const part of sentenceParts) {
            const newLength = currentLength + part.length + (currentSentences.length > 0 ? 1 : 0);

            if (currentSentences.length > 0 && newLength > maxChunkSize) {
                chunks.push({
                    index: chunkIndex++,
                    text: currentSentences.join(' ').trim(),
                    sentenceCount: currentSentences.length,
                });

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

        if (paragraphBreak && currentLength >= maxChunkSize * 0.3) {
            chunks.push({
                index: chunkIndex++,
                text: currentSentences.join(' ').trim(),
                sentenceCount: currentSentences.length,
            });

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

    if (currentSentences.length > 0) {
        chunks.push({
            index: chunkIndex,
            text: currentSentences.join(' ').trim(),
            sentenceCount: currentSentences.length,
        });
    }

    return chunks;
}

export function smartSplitText(
    text: string,
    options: SmartSplitterOptions = {}
): TextChunk[] {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const { maxChunkSize, overlapSentences, minChunkSize, semanticSeparators } = opts;

    if (!text || text.trim().length === 0) {
        return [];
    }

    let semanticBlocks = splitBySemanticSeparators(text, semanticSeparators);

    semanticBlocks = mergeSmallBlocks(semanticBlocks, minChunkSize, maxChunkSize);

    const chunks: TextChunk[] = [];

    for (const block of semanticBlocks) {
        if (block.length <= maxChunkSize) {
            const sentenceCount = tokenizeSentences(block).length || 1;
            chunks.push({ index: chunks.length, text: block, sentenceCount });
        } else {
            const subChunks = splitBySentences(block, maxChunkSize, overlapSentences);
            for (const sub of subChunks) {
                chunks.push({ index: chunks.length, text: sub.text, sentenceCount: sub.sentenceCount });
            }
        }
    }

    return chunks;
}
