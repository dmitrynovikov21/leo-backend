import axios from 'axios';
import { config } from '../config';

export interface QuizAnswers {
    role: 'sales' | 'lead_qualification' | 'support' | 'info_consultant';

    // Sales-specific
    salesCta?: 'meeting' | 'payment' | 'phone' | 'custom';
    salesCtaCustom?: string;
    salesPersistence?: 'aggressive' | 'consultative' | 'passive' | 'custom';
    salesPersistenceCustom?: string;

    // Lead qualification
    leadFilter?: 'vacuum' | 'sniper' | 'custom';
    leadFilterCustom?: string;
    leadStrategy?: 'native' | 'survey' | 'custom';
    leadStrategyCustom?: string;
    surveyQuestions?: string[];

    // Support
    supportEmpathy?: 'maximum' | 'professional' | 'custom';
    supportEmpathyCustom?: string;
    supportLanguage?: 'beginner' | 'expert' | 'custom';
    supportLanguageCustom?: string;

    // Info consultant
    infoInterpretation?: 'strict' | 'analyst' | 'custom';
    infoInterpretationCustom?: string;
    infoOfftopic?: 'ignore' | 'polite' | 'custom';
    infoOfftopicCustom?: string;

    // Global settings
    toneOfVoice?: 'official' | 'friendly' | 'casual' | 'custom';
    toneOfVoiceCustom?: string;
    responseLength?: 'concise' | 'balanced' | 'detailed' | 'custom';
    responseLengthCustom?: string;
    fallback?: 'admit' | 'contact' | 'guess' | 'custom';
    fallbackCustom?: string;

    // Constraints
    constraints?: string[];
    customConstraints?: string[];
}

export interface GeneratePromptRequest {
    userId: string;
    agentName: string;
    agentDescription: string;
    quizAnswers: QuizAnswers;
}

// Human-readable mappings for prompt generation
const ROLE_LABELS: Record<string, string> = {
    sales: 'Продажник',
    lead_qualification: 'Квалификатор лидов',
    support: 'Техподдержка',
    info_consultant: 'Информационный консультант',
};

const SALES_CTA_LABELS: Record<string, string> = {
    meeting: 'записать клиента на встречу/созвон',
    payment: 'привести к оплате',
    phone: 'получить номер телефона',
    custom: 'кастомная цель',
};

const SALES_PERSISTENCE_LABELS: Record<string, string> = {
    aggressive: 'агрессивный стиль продаж',
    consultative: 'консультативный стиль продаж',
    passive: 'пассивный стиль продаж',
    custom: 'кастомный стиль',
};

const LEAD_FILTER_LABELS: Record<string, string> = {
    vacuum: 'собирать всех лидов без фильтрации',
    sniper: 'жёстко фильтровать только целевых лидов',
    custom: 'кастомный фильтр',
};

const LEAD_STRATEGY_LABELS: Record<string, string> = {
    native: 'собирать информацию нативно в диалоге',
    survey: 'использовать структурированные вопросы',
    custom: 'кастомная стратегия',
};

const SUPPORT_EMPATHY_LABELS: Record<string, string> = {
    maximum: 'максимальная эмпатия и понимание',
    professional: 'профессиональный, но сдержанный тон',
    custom: 'кастомный уровень эмпатии',
};

const SUPPORT_LANGUAGE_LABELS: Record<string, string> = {
    beginner: 'простой язык для новичков',
    expert: 'технический язык для экспертов',
    custom: 'кастомный уровень языка',
};

const INFO_INTERPRETATION_LABELS: Record<string, string> = {
    strict: 'строго придерживаться фактов из базы знаний',
    analyst: 'анализировать и делать выводы на основе данных',
    custom: 'кастомная интерпретация',
};

const INFO_OFFTOPIC_LABELS: Record<string, string> = {
    ignore: 'игнорировать оффтопик-вопросы',
    polite: 'вежливо отклонять оффтопик-вопросы',
    custom: 'кастомная реакция на оффтопик',
};

const TONE_LABELS: Record<string, string> = {
    official: 'официальный и формальный',
    friendly: 'дружелюбный и тёплый',
    casual: 'непринуждённый и разговорный',
    custom: 'кастомный тон',
};

const RESPONSE_LENGTH_LABELS: Record<string, string> = {
    concise: 'краткие и лаконичные ответы',
    balanced: 'сбалансированные ответы',
    detailed: 'развёрнутые и подробные ответы',
    custom: 'кастомная длина',
};

const FALLBACK_LABELS: Record<string, string> = {
    admit: 'честно признать незнание',
    contact: 'перенаправить к человеку-специалисту',
    guess: 'попытаться дать наилучший ответ',
    custom: 'кастомная стратегия',
};

const CONSTRAINT_LABELS: Record<string, string> = {
    no_swearing: 'Не использовать ненормативную лексику',
    no_prices: 'Не называть конкретные цены',
    no_competitors: 'Не обсуждать конкурентов',
    no_hallucination: 'Не выдумывать информацию, которой нет в базе знаний',
};

class QuizPromptService {
    private buildRoleContext(role: string, answers: QuizAnswers): string {
        const parts: string[] = [];
        parts.push(`Роль: ${ROLE_LABELS[role] || role}`);

        switch (role) {
            case 'sales':
                if (answers.salesCta) {
                    const ctaValue = answers.salesCta === 'custom'
                        ? answers.salesCtaCustom
                        : SALES_CTA_LABELS[answers.salesCta];
                    parts.push(`Цель продажи: ${ctaValue}`);
                }
                if (answers.salesPersistence) {
                    const persistValue = answers.salesPersistence === 'custom'
                        ? answers.salesPersistenceCustom
                        : SALES_PERSISTENCE_LABELS[answers.salesPersistence];
                    parts.push(`Стиль продаж: ${persistValue}`);
                }
                break;

            case 'lead_qualification':
                if (answers.leadFilter) {
                    const filterValue = answers.leadFilter === 'custom'
                        ? answers.leadFilterCustom
                        : LEAD_FILTER_LABELS[answers.leadFilter];
                    parts.push(`Фильтрация лидов: ${filterValue}`);
                }
                if (answers.leadStrategy) {
                    const strategyValue = answers.leadStrategy === 'custom'
                        ? answers.leadStrategyCustom
                        : LEAD_STRATEGY_LABELS[answers.leadStrategy];
                    parts.push(`Стратегия сбора информации: ${strategyValue}`);
                }
                if (answers.surveyQuestions && answers.surveyQuestions.length > 0) {
                    parts.push(`Вопросы для квалификации:\n${answers.surveyQuestions.map((q, i) => `  ${i + 1}. ${q}`).join('\n')}`);
                }
                break;

            case 'support':
                if (answers.supportEmpathy) {
                    const empathyValue = answers.supportEmpathy === 'custom'
                        ? answers.supportEmpathyCustom
                        : SUPPORT_EMPATHY_LABELS[answers.supportEmpathy];
                    parts.push(`Уровень эмпатии: ${empathyValue}`);
                }
                if (answers.supportLanguage) {
                    const langValue = answers.supportLanguage === 'custom'
                        ? answers.supportLanguageCustom
                        : SUPPORT_LANGUAGE_LABELS[answers.supportLanguage];
                    parts.push(`Уровень технического языка: ${langValue}`);
                }
                break;

            case 'info_consultant':
                if (answers.infoInterpretation) {
                    const interpValue = answers.infoInterpretation === 'custom'
                        ? answers.infoInterpretationCustom
                        : INFO_INTERPRETATION_LABELS[answers.infoInterpretation];
                    parts.push(`Интерпретация данных: ${interpValue}`);
                }
                if (answers.infoOfftopic) {
                    const offtopicValue = answers.infoOfftopic === 'custom'
                        ? answers.infoOfftopicCustom
                        : INFO_OFFTOPIC_LABELS[answers.infoOfftopic];
                    parts.push(`Реакция на оффтопик: ${offtopicValue}`);
                }
                break;
        }

        return parts.join('\n');
    }

    private buildGlobalContext(answers: QuizAnswers): string {
        const parts: string[] = [];

        if (answers.toneOfVoice) {
            const toneValue = answers.toneOfVoice === 'custom'
                ? answers.toneOfVoiceCustom
                : TONE_LABELS[answers.toneOfVoice];
            parts.push(`Тон общения: ${toneValue}`);
        }

        if (answers.responseLength) {
            const lengthValue = answers.responseLength === 'custom'
                ? answers.responseLengthCustom
                : RESPONSE_LENGTH_LABELS[answers.responseLength];
            parts.push(`Длина ответов: ${lengthValue}`);
        }

        if (answers.fallback) {
            const fallbackValue = answers.fallback === 'custom'
                ? answers.fallbackCustom
                : FALLBACK_LABELS[answers.fallback];
            parts.push(`Стратегия при незнании: ${fallbackValue}`);
        }

        return parts.join('\n');
    }

    private buildConstraintsContext(answers: QuizAnswers): string {
        const constraints: string[] = [];

        if (answers.constraints) {
            for (const c of answers.constraints) {
                if (CONSTRAINT_LABELS[c]) {
                    constraints.push(`- ${CONSTRAINT_LABELS[c]}`);
                }
            }
        }

        if (answers.customConstraints) {
            for (const c of answers.customConstraints) {
                constraints.push(`- ${c}`);
            }
        }

        return constraints.length > 0 ? `Ограничения:\n${constraints.join('\n')}` : '';
    }

    async generatePrompt(data: GeneratePromptRequest): Promise<string> {
        const { userId, agentName, agentDescription, quizAnswers } = data;

        // Build context for LLM
        const roleContext = this.buildRoleContext(quizAnswers.role, quizAnswers);
        const globalContext = this.buildGlobalContext(quizAnswers);
        const constraintsContext = this.buildConstraintsContext(quizAnswers);

        const configContext = `
## Информация об агенте
Имя: ${agentName}
Описание: ${agentDescription}

## Конфигурация
${roleContext}

${globalContext}

${constraintsContext}
`.trim();

        const systemPrompt = `You are an expert AI prompt engineer specializing in creating Russian-language system instructions for AI assistants.

Your task is to generate a detailed, well-structured system prompt in Russian based on the configuration provided.

The generated prompt should:
1. Start with "# РОЛЬ" section describing who the AI is
2. Include "# ЦЕЛЬ" section with the main objective
3. Include "# СТИЛЬ ОБЩЕНИЯ" section based on tone and response length settings
4. Include "# ПРАВИЛА" section with specific behavioral rules
5. Include "# ОГРАНИЧЕНИЯ" section if there are any constraints
6. Be written in natural, fluent Russian
7. Be specific and actionable, not generic
8. Use markdown formatting

Generate ONLY the system prompt content, nothing else.`;

        const userMessage = `Создай системный промпт для AI-агента на основе следующей конфигурации:

${configContext}`;

        try {
            const response = await axios.post(`${config.gatewayUrl}/api/v1/chat/completions`, {
                userId,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage },
                ],
                model: 'claude-haiku-4',
                temperature: 0.7,
                max_tokens: 2000,
            });

            const generatedPrompt = response.data?.choices?.[0]?.message?.content;

            if (!generatedPrompt) {
                throw new Error('Empty response from LLM');
            }

            return generatedPrompt;
        } catch (error: any) {
            console.error('Quiz prompt generation error:', error.message);
            throw new Error(`Failed to generate prompt: ${error.message}`);
        }
    }
}

export const quizPromptService = new QuizPromptService();
