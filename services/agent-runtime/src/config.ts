import { z } from 'zod';

const envSchema = z.object({
    AGENT_ID: z.string(),
    USER_ID: z.string(),
    AGENT_NAME: z.string().default('Leo Agent'),
    SYSTEM_PROMPT: z.string().default('You are a helpful assistant.'),
    TELEGRAM_BOT_TOKEN: z.string().default(''),
    GATEWAY_URL: z.string().default('http://leo-gateway:8080'),
    DATABASE_URL: z.string(),
    // LangSmith
    LANGCHAIN_TRACING_V2: z.string().optional(),
    LANGCHAIN_API_KEY: z.string().optional(),
    LANGCHAIN_PROJECT: z.string().optional(),
    // Memory settings
    MAX_MESSAGES: z.string().default('20'),
    KEEP_MESSAGES: z.string().default('10'),
    DEBOUNCE_MS: z.string().default('5000'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
    // Behavior settings
    DISPLAY_NAME: z.string().optional(),
    AVATAR_EMOJI: z.string().optional(),
    TEMPERATURE: z.string().default('0.7'),
    WELCOME_MESSAGE: z.string().optional(),
    TONE: z.string().default('[]'),
    GUARDRAILS: z.string().default('[]'),
    IDENTITY_INSTRUCTION: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
    process.exit(1);
}

// Parse JSON arrays safely
function parseJsonArray<T>(str: string): T[] {
    try {
        const arr = JSON.parse(str);
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

export const config = {
    agentId: parsed.data.AGENT_ID,
    userId: parsed.data.USER_ID,
    agentName: parsed.data.AGENT_NAME,
    systemPrompt: parsed.data.SYSTEM_PROMPT,
    telegramBotToken: parsed.data.TELEGRAM_BOT_TOKEN,
    gatewayUrl: parsed.data.GATEWAY_URL,
    databaseUrl: parsed.data.DATABASE_URL,
    // LangSmith
    langchainTracingV2: parsed.data.LANGCHAIN_TRACING_V2 === 'true',
    langchainApiKey: parsed.data.LANGCHAIN_API_KEY,
    langchainProject: parsed.data.LANGCHAIN_PROJECT,
    // Memory
    maxMessages: parseInt(parsed.data.MAX_MESSAGES, 10),
    keepMessages: parseInt(parsed.data.KEEP_MESSAGES, 10),
    debounceMs: parseInt(parsed.data.DEBOUNCE_MS, 10),
    nodeEnv: parsed.data.NODE_ENV,
    isDev: parsed.data.NODE_ENV === 'development',
    // Behavior
    displayName: parsed.data.DISPLAY_NAME || null,
    avatarEmoji: parsed.data.AVATAR_EMOJI || null,
    temperature: parseFloat(parsed.data.TEMPERATURE) || 0.7,
    welcomeMessage: parsed.data.WELCOME_MESSAGE || null,
    tone: parseJsonArray<string>(parsed.data.TONE),
    guardrails: parseJsonArray<{ id: string; rule: string }>(parsed.data.GUARDRAILS),
    identityInstruction: parsed.data.IDENTITY_INSTRUCTION || null,
};
