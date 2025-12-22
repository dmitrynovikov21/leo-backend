import { z } from 'zod';

const envSchema = z.object({
    PORT: z.string().default('8080'),
    DATABASE_URL: z.string(),
    LITELLM_URL: z.string().default('http://litellm:4000'),
    CHROMA_URL: z.string().default('http://chroma:8000'),
    OPENAI_API_KEY: z.string().optional(),
    EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
    DEFAULT_LLM_MODEL: z.string().default('gpt-4o-mini'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
    process.exit(1);
}

export const config = {
    port: parseInt(parsed.data.PORT, 10),
    databaseUrl: parsed.data.DATABASE_URL,
    litellmUrl: parsed.data.LITELLM_URL,
    chromaUrl: parsed.data.CHROMA_URL,
    openaiApiKey: parsed.data.OPENAI_API_KEY,
    embeddingModel: parsed.data.EMBEDDING_MODEL,
    defaultLlmModel: parsed.data.DEFAULT_LLM_MODEL,
    nodeEnv: parsed.data.NODE_ENV,
    isDev: parsed.data.NODE_ENV === 'development',
};
