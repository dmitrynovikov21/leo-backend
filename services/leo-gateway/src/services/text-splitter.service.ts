/**
 * Recursive Character Text Splitter
 * Based on LangChain's RecursiveCharacterTextSplitter logic
 */

export interface TextChunk {
    index: number;
    text: string;
    startChar: number;
    endChar: number;
}

export interface SplitterOptions {
    chunkSize?: number;
    chunkOverlap?: number;
    separators?: string[];
}

const DEFAULT_SEPARATORS = ['\n\n', '\n', '. ', ', ', ' ', ''];

export function splitText(
    text: string,
    options: SplitterOptions = {}
): TextChunk[] {
    const {
        chunkSize = 1000,
        chunkOverlap = 200,
        separators = DEFAULT_SEPARATORS,
    } = options;

    const chunks: TextChunk[] = [];

    function splitRecursively(text: string, seps: string[]): string[] {
        if (text.length <= chunkSize) {
            return [text];
        }

        if (seps.length === 0) {
            // No more separators, just split by size
            const result: string[] = [];
            for (let i = 0; i < text.length; i += chunkSize - chunkOverlap) {
                result.push(text.slice(i, i + chunkSize));
            }
            return result;
        }

        const [sep, ...remainingSeps] = seps;
        const parts = text.split(sep);

        const result: string[] = [];
        let current = '';

        for (const part of parts) {
            const candidate = current ? current + sep + part : part;

            if (candidate.length <= chunkSize) {
                current = candidate;
            } else {
                if (current) {
                    result.push(current);
                }

                if (part.length > chunkSize) {
                    // Part is too large, split recursively with remaining separators
                    const subChunks = splitRecursively(part, remainingSeps);
                    result.push(...subChunks);
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

    const rawChunks = splitRecursively(text, separators);

    // Add overlap between chunks
    const finalChunks: string[] = [];

    for (let i = 0; i < rawChunks.length; i++) {
        let chunk = rawChunks[i];

        // Add overlap from previous chunk
        if (i > 0 && chunkOverlap > 0) {
            const prevChunk = rawChunks[i - 1];
            const overlapText = prevChunk.slice(-chunkOverlap);
            chunk = overlapText + chunk;
        }

        finalChunks.push(chunk.trim());
    }

    // Build result with positions
    let charPos = 0;

    for (let i = 0; i < finalChunks.length; i++) {
        const chunkText = finalChunks[i];

        if (chunkText.length === 0) continue;

        // Find actual position in original text (approximate due to overlap)
        const foundPos = text.indexOf(chunkText.slice(0, 50), charPos);
        const startChar = foundPos >= 0 ? foundPos : charPos;

        chunks.push({
            index: i,
            text: chunkText,
            startChar,
            endChar: startChar + chunkText.length,
        });

        charPos = startChar + Math.max(1, chunkText.length - chunkOverlap);
    }

    return chunks;
}

export function splitTextSimple(
    text: string,
    chunkSize: number = 1000,
    chunkOverlap: number = 200
): TextChunk[] {
    return splitText(text, { chunkSize, chunkOverlap });
}
