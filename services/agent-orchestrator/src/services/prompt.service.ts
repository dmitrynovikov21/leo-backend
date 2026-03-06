import { queryOne } from '../db';

const FALLBACK_PROMPTS: Record<string, string> = {
    quiz_meta_architect: `Ты генерируешь системный промпт для AI-агента на платформе Leo.

КОНТЕКСТ ПЛАТФОРМЫ:
- Агенты работают в Telegram и веб-чате
- Форматирование: HTML-теги (<b>, <i>, <code>). НЕ Markdown.
- У агента есть база знаний (RAG) в теге <known_information>
- Агент получает Notes администратора как IMPORTANT UPDATES

ВХОД: ответы клиента на квиз (бизнес, цели, тон, ограничения).

ЗАДАЧА: Сгенерируй системный промпт для агента.

ТРЕБОВАНИЯ К ПРОМПТУ:
1. Максимум 500 слов. Каждое предложение должно менять поведение модели.
2. Определи роль агента: кто он для клиента (консультант, ассистент, менеджер)
3. Укажи конкретные действия: как отвечать, что предлагать, куда направлять
4. Добавь обработку типовых сценариев для этого бизнеса
5. НЕ дублируй правила из platform_core (формат, мультиязычность, RAG — уже есть)
6. НЕ используй XML-теги, эмодзи, пафосные роли ("Senior Expert")
7. Пиши на русском

ФОРМАТ ОТВЕТА: только текст промпта, без пояснений и обёрток.`
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
