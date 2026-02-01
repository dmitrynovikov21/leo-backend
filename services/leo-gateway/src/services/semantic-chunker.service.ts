import { litellmService } from './litellm.service';
import { promptService } from './prompt.service';

export interface SemanticChunk {
    index: number;
    title: string;
    text: string;
}



export async function semanticChunking(text: string): Promise<SemanticChunk[]> {
    // For very long texts, split into manageable parts first
    const MAX_INPUT_LENGTH = 8000; // ~2K tokens (safer for 4k-8k output)

    if (text.length > MAX_INPUT_LENGTH) {
        // Split long text into parts and process each
        const parts: string[] = [];
        let start = 0;

        while (start < text.length) {
            // Find a good breaking point (paragraph or sentence)
            let end = Math.min(start + MAX_INPUT_LENGTH, text.length);

            if (end < text.length) {
                // Try to find paragraph break
                const paragraphBreak = text.lastIndexOf('\n\n', end);
                if (paragraphBreak > start + MAX_INPUT_LENGTH / 2) {
                    end = paragraphBreak + 2;
                } else {
                    // Try sentence break
                    const sentenceBreak = text.lastIndexOf('. ', end);
                    if (sentenceBreak > start + MAX_INPUT_LENGTH / 2) {
                        end = sentenceBreak + 2;
                    }
                }
            }

            parts.push(text.slice(start, end));
            start = end;
        }

        // Process each part
        const allChunks: SemanticChunk[] = [];
        let globalIndex = 0;

        for (const part of parts) {
            const partChunks = await processTextPart(part);
            for (const chunk of partChunks) {
                allChunks.push({
                    ...chunk,
                    index: globalIndex++,
                });
            }
        }

        return allChunks;
    }

    return processTextPart(text);
}

async function processTextPart(text: string): Promise<SemanticChunk[]> {
    try {
        const prompt = await promptService.getPrompt('semantic_chunking');

        const response = await litellmService.chatCompletion({
            messages: [
                { role: 'system', content: prompt },
                { role: 'user', content: text },
            ],
            temperature: 0.3,
            max_tokens: 8192,
        });

        const content = response.choices[0]?.message?.content;

        if (!content) {
            throw new Error('Empty response from LLM');
        }

        console.log('🤖 Raw LLM Chunking Response:', content);

        // Clean content from markdown code blocks
        let cleanContent = content.replace(/```json/g, '').replace(/```/g, '').trim();

        // Try to parse JSON from response
        const jsonMatch = cleanContent.match(/\{[\s\S]*\}|\[[\s\S]*\]/);

        if (!jsonMatch) {
            // Try to find if it's just an array
            throw new Error('No JSON found in response');
        }

        let parsed;
        try {
            parsed = JSON.parse(jsonMatch[0]);
        } catch (e) {
            console.error('Failed to parse JSON:', jsonMatch[0]);
            throw new Error('Invalid JSON format');
        }

        // Handle both {chunks: [...]} and [...] formats
        const chunksArray = Array.isArray(parsed) ? parsed : parsed.chunks;

        if (!Array.isArray(chunksArray)) {
            throw new Error('Invalid response format: chunks array not found');
        }

        return chunksArray.map((chunk: any, i: number) => ({
            index: chunk.index ?? i,
            title: chunk.title || `Chunk ${i}`,
            text: chunk.text || '',
        }));

    } catch (error: any) {
        console.error('Semantic chunking error:', error.message);

        // Fallback: return text as single chunk
        return [{
            index: 0,
            title: 'Document',
            text: text,
        }];
    }
}
