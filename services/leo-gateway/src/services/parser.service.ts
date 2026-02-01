import mammoth from 'mammoth';
import * as xlsx from 'xlsx';
import pdf from 'pdf-parse';
import { getTextExtractor } from 'office-text-extractor';
import { extractTextFromImage, IMAGE_MIME_TYPES } from './ocr.service';

export interface ParsedDocument {
    text: string;      // raw text for new /parse endpoint
    content: string;   // alias for text (legacy compatibility)
    chunks: DocumentChunk[];
}

export interface DocumentChunk {
    id: string;
    content: string;
    metadata: {
        source: string;
        chunkIndex: number;
        mimeType: string;
        [key: string]: any;
    };
}

const CHUNK_SIZE = 1000; // characters
const CHUNK_OVERLAP = 200;

/**
 * Parse image file using OCR
 */
export async function parseImage(buffer: Buffer, filename: string, mimeType: string): Promise<ParsedDocument> {
    console.log(`🖼️ Parsing image: ${filename}`);
    const content = await extractTextFromImage(buffer);
    const chunks = splitIntoChunks(content, filename, mimeType);
    return { text: content, content, chunks };
}

function splitIntoChunks(text: string, source: string, mimeType: string): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    let start = 0;
    let chunkIndex = 0;

    while (start < text.length) {
        const end = Math.min(start + CHUNK_SIZE, text.length);
        const content = text.slice(start, end).trim();

        if (content.length > 0) {
            chunks.push({
                id: `${source}_chunk_${chunkIndex}`,
                content,
                metadata: {
                    source,
                    chunkIndex,
                    mimeType,
                },
            });
            chunkIndex++;
        }

        start = end - CHUNK_OVERLAP;
        if (start >= text.length - CHUNK_OVERLAP) break;
    }

    return chunks;
}

export async function parseDocx(buffer: Buffer, filename: string): Promise<ParsedDocument> {
    const result = await mammoth.extractRawText({ buffer });
    const content = result.value;
    const chunks = splitIntoChunks(content, filename, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

    return { text: content, content, chunks };
}

export async function parseXlsx(buffer: Buffer, filename: string): Promise<ParsedDocument> {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheets: string[] = [];

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const text = xlsx.utils.sheet_to_txt(sheet);
        sheets.push(`Sheet: ${sheetName}\n${text}`);
    }

    const content = sheets.join('\n\n');
    const chunks = splitIntoChunks(content, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    return { text: content, content, chunks };
}

export async function parsePdf(buffer: Buffer, filename: string): Promise<ParsedDocument> {
    const data = await pdf(buffer);
    const content = data.text;
    const chunks = splitIntoChunks(content, filename, 'application/pdf');

    return { text: content, content, chunks };
}

export async function parseText(buffer: Buffer, filename: string): Promise<ParsedDocument> {
    const content = buffer.toString('utf-8');
    const chunks = splitIntoChunks(content, filename, 'text/plain');

    return { text: content, content, chunks };
}

export async function parseCsv(buffer: Buffer, filename: string): Promise<ParsedDocument> {
    // Use xlsx to parse CSV into a structured readable format
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const content = xlsx.utils.sheet_to_txt(sheet);
    const chunks = splitIntoChunks(content, filename, 'text/csv');

    return { text: content, content, chunks };
}

export async function parseJson(buffer: Buffer, filename: string): Promise<ParsedDocument> {
    const raw = buffer.toString('utf-8');
    let content: string;

    try {
        const parsed = JSON.parse(raw);
        content = JSON.stringify(parsed, null, 2);
    } catch {
        // If JSON is invalid, use raw text
        content = raw;
    }

    const chunks = splitIntoChunks(content, filename, 'application/json');
    return { text: content, content, chunks };
}

export async function parseHtml(buffer: Buffer, filename: string): Promise<ParsedDocument> {
    let html = buffer.toString('utf-8');

    // Remove script and style blocks with their content
    html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<style[\s\S]*?<\/style>/gi, '');

    // Convert block elements to newlines
    html = html.replace(/<\/(p|div|h[1-6]|li|tr|br|blockquote|section|article|header|footer)>/gi, '\n');
    html = html.replace(/<br\s*\/?>/gi, '\n');
    html = html.replace(/<\/td>/gi, '\t');

    // Strip remaining tags
    html = html.replace(/<[^>]+>/g, '');

    // Decode common HTML entities
    html = html
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');

    // Clean up whitespace
    const content = html
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join('\n');

    const chunks = splitIntoChunks(content, filename, 'text/html');
    return { text: content, content, chunks };
}

export async function parsePptx(buffer: Buffer, filename: string): Promise<ParsedDocument> {
    const extractor = getTextExtractor();
    const content = await extractor.extractText({
        input: buffer,
        type: 'buffer',
    });
    const chunks = splitIntoChunks(content, filename, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');

    return { text: content, content, chunks };
}

export async function parseDocument(
    buffer: Buffer,
    filename: string,
    mimeType: string
): Promise<ParsedDocument> {
    // Check if it's an image - use OCR
    if (IMAGE_MIME_TYPES.includes(mimeType)) {
        return parseImage(buffer, filename, mimeType);
    }

    switch (mimeType) {
        case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        case 'application/msword':
            return parseDocx(buffer, filename);

        case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
        case 'application/vnd.ms-excel':
            return parseXlsx(buffer, filename);

        case 'application/pdf':
            return parsePdf(buffer, filename);

        case 'text/csv':
        case 'application/csv':
            return parseCsv(buffer, filename);

        case 'application/json':
            return parseJson(buffer, filename);

        case 'text/html':
            return parseHtml(buffer, filename);

        case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
        case 'application/vnd.ms-powerpoint':
            return parsePptx(buffer, filename);

        case 'text/plain':
        case 'text/markdown':
            return parseText(buffer, filename);

        default:
            // Try to parse as text
            return parseText(buffer, filename);
    }
}

