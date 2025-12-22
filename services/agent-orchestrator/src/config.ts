import { z } from 'zod';

const envSchema = z.object({
    PORT: z.string().default('8081'),
    DATABASE_URL: z.string(),
    GATEWAY_URL: z.string().default('http://leo-gateway:8080'),
    AGENT_IMAGE: z.string().default('leo-agent-runtime:latest'),
    DOCKER_NETWORK: z.string().default('leo_default'),
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
    gatewayUrl: parsed.data.GATEWAY_URL,
    agentImage: parsed.data.AGENT_IMAGE,
    dockerNetwork: parsed.data.DOCKER_NETWORK,
    nodeEnv: parsed.data.NODE_ENV,
    isDev: parsed.data.NODE_ENV === 'development',
};
