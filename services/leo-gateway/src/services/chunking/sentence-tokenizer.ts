/**
 * Sentence Tokenizer
 * Splits text into sentences, handling abbreviations correctly
 * Supports Russian and English
 */

// Common abbreviations that should NOT end a sentence
const ABBREVIATIONS_EN = new Set([
    'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'vs', 'etc', 'inc', 'ltd', 'corp',
    'e.g', 'i.e', 'fig', 'vol', 'no', 'pp', 'pg', 'jan', 'feb', 'mar', 'apr',
    'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'st', 'ave', 'blvd'
]);

const ABBREVIATIONS_RU = new Set([
    'г', 'гг', 'т', 'д', 'п', 'стр', 'с', 'см', 'рис', 'табл', 'ред', 'изд',
    'т.д', 'т.п', 'т.е', 'т.к', 'т.н', 'пр', 'др', 'гр', 'руб', 'коп',
    'млн', 'млрд', 'тыс', 'кв', 'куб', 'мин', 'сек', 'час', 'год', 'вв',
    'н.э', 'до н.э', 'р', 'обл', 'ул', 'пер', 'кв-л', 'д', 'корп', 'стр'
]);

// Sentence ending punctuation
const SENTENCE_ENDERS = /[.!?…]+$/;
const SENTENCE_ENDER_CHARS = new Set(['.', '!', '?', '…']);

/**
 * Check if a word is an abbreviation
 */
function isAbbreviation(word: string): boolean {
    const normalized = word.toLowerCase().replace(/\.$/, '');
    return ABBREVIATIONS_EN.has(normalized) || ABBREVIATIONS_RU.has(normalized);
}

/**
 * Check if character at position is likely a sentence boundary
 */
function isSentenceBoundary(text: string, pos: number): boolean {
    const char = text[pos];

    if (!SENTENCE_ENDER_CHARS.has(char)) {
        return false;
    }

    // Look for the word before the punctuation
    let wordStart = pos - 1;
    while (wordStart >= 0 && /[a-zA-Zа-яА-ЯёЁ]/.test(text[wordStart])) {
        wordStart--;
    }
    wordStart++;

    const wordBefore = text.slice(wordStart, pos);

    // If it's an abbreviation, not a sentence boundary
    if (wordBefore && isAbbreviation(wordBefore)) {
        return false;
    }

    // Check for numbers (like "5." in lists)
    if (/^\d+$/.test(wordBefore)) {
        // Could be a list item or decimal - check what follows
        const nextChar = text[pos + 1];
        if (nextChar && /\d/.test(nextChar)) {
            return false; // It's a decimal number
        }
    }

    // Check if next character suggests continuation (lowercase letter without space)
    let nextPos = pos + 1;
    while (nextPos < text.length && /[\s]/.test(text[nextPos])) {
        nextPos++;
    }

    const nextChar = text[nextPos];
    if (!nextChar) {
        return true; // End of text
    }

    // If next real char is uppercase or a quote, likely sentence boundary
    if (/[A-ZА-ЯЁ«"'(]/.test(nextChar)) {
        return true;
    }

    // If next char is lowercase, check if there was a newline (paragraph break)
    if (text.slice(pos + 1, nextPos).includes('\n')) {
        return true;
    }

    // Default: treat as sentence boundary if followed by space
    return text[pos + 1] === ' ';
}

/**
 * Tokenize text into sentences
 */
export function tokenizeSentences(text: string): string[] {
    if (!text || text.trim().length === 0) {
        return [];
    }

    const sentences: string[] = [];
    let currentStart = 0;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (SENTENCE_ENDER_CHARS.has(char)) {
            // Skip consecutive punctuation (like "..." or "?!")
            while (i + 1 < text.length && SENTENCE_ENDER_CHARS.has(text[i + 1])) {
                i++;
            }

            if (isSentenceBoundary(text, i)) {
                const sentence = text.slice(currentStart, i + 1).trim();
                if (sentence.length > 0) {
                    sentences.push(sentence);
                }
                currentStart = i + 1;
            }
        }
    }

    // Add remaining text as last sentence
    const remaining = text.slice(currentStart).trim();
    if (remaining.length > 0) {
        sentences.push(remaining);
    }

    return sentences;
}

/**
 * Split text into paragraphs (by double newline or significant whitespace)
 */
export function tokenizeParagraphs(text: string): string[] {
    // Split by double newline or multiple newlines
    const paragraphs = text.split(/\n\s*\n+/);

    return paragraphs
        .map(p => p.trim())
        .filter(p => p.length > 0);
}
