import Tesseract from 'tesseract.js';

/**
 * Extract text from an image using Tesseract OCR
 * @param buffer - Image buffer
 * @param languages - Language codes (default: rus+eng)
 * @returns Extracted text
 */
export async function extractTextFromImage(
    buffer: Buffer,
    languages: string = 'rus+eng'
): Promise<string> {
    console.log(`🔍 Starting OCR with languages: ${languages}`);

    const result = await Tesseract.recognize(buffer, languages, {
        logger: (m) => {
            if (m.status === 'recognizing text') {
                console.log(`📖 OCR progress: ${Math.round(m.progress * 100)}%`);
            }
        },
    });

    const text = result.data.text.trim();
    console.log(`✅ OCR completed. Extracted ${text.length} characters`);

    return text;
}

/**
 * Check if MIME type is an image that can be processed by OCR
 */
export function isImageMimeType(mimeType: string): boolean {
    const imageMimeTypes = [
        'image/png',
        'image/jpeg',
        'image/jpg',
        'image/webp',
        'image/bmp',
        'image/tiff',
        'image/gif',
    ];
    return imageMimeTypes.includes(mimeType);
}

export const IMAGE_MIME_TYPES = [
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/bmp',
    'image/tiff',
    'image/gif',
];
