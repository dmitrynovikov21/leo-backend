import { queryOne } from '../db';
import { config } from '../config';

// Fallback prompts if DB is unreachable
const FALLBACK_PROMPTS: Record<string, string> = {
    platform_core: `Ты — AI-агент на платформе Leo.
НИКОГДА не используй Markdown разметку (bold, italic, headers) в ответах, если пользователь не попросил код. Пиши plain text.
Твоя задача — быть полезным и точным.
Если данных в контексте недостаточно — не выдумывай.`,

    conflict_detection_protocol: `## ПРОТОКОЛ ОБНАРУЖЕНИЯ КОНФЛИКТОВ
При анализе предоставленного контекста (РЕЛЕВАНТНАЯ ИНФОРМАЦИЯ и IMPORTANT UPDATES):
1. **ВНИМАТЕЛЬНО СРАВНИВАЙ** факты, цифры, цены, даты и условия из разных фрагментов.
2. ЕСЛИ ты видишь разные значения для одного и того же факта (например, в одном месте "цена 100", в другом "цена 200"):
   - НЕ пытайся угадать, какое значение правильное (даже если написано High Priority).
   - НЕ выбирай значение случайно.
   - **НЕМЕДЛЕННО** вызови инструмент \`report_conflict\`!
   - В аргументах вызова укажи найденные противоречивые значения и их источники (номера фрагментов [1], [2] и т.д.).
   - В ответе пользователю напиши: "Я вижу противоречивую информацию в базе знаний: в одном месте указано X, а в другом Y."`,

    summarization_template: `Ты — ассистент для суммаризации диалогов.
Создай краткое резюме диалога, сохраняя:
- Ключевые темы и вопросы пользователя
- Важные факты и решения
- Контекст для продолжения беседы

Формат: 2-3 абзаца, на русском языке.`
};

class PromptService {
    private cache = new Map<string, string>();

    async getPrompt(key: string): Promise<string> {
        if (this.cache.has(key)) {
            return this.cache.get(key)!;
        }

        try {
            const result = await queryOne<{ content: string }>(
                `SELECT content FROM global_system_prompts WHERE key = $1 AND is_active = true`,
                [key]
            );

            if (result?.content) {
                this.cache.set(key, result.content);
                return result.content;
            }
        } catch (error) {
            console.warn(`⚠️ Failed to fetch prompt '${key}' from DB, using fallback`);
        }

        return FALLBACK_PROMPTS[key] || '';
    }

    clearCache() {
        this.cache.clear();
    }
}

export const promptService = new PromptService();
