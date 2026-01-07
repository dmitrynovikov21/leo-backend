import axios, { AxiosInstance } from 'axios';
import { config } from './config';
import { MemoryManager, StoredMessage } from './memory/manager';

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface ChatCompletionResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: {
        index: number;
        message: ChatMessage;
        finish_reason: string;
    }[];
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

class LLMClient {
    private client: AxiosInstance;

    constructor() {
        this.client = axios.create({
            baseURL: config.gatewayUrl,
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 120000, // 2 minutes for LLM responses
        });
    }

    async chat(messages: ChatMessage[], model?: string): Promise<string> {
        try {
            const response = await this.client.post<ChatCompletionResponse>('/api/v1/chat/completions', {
                userId: config.userId,
                agentId: config.agentId,
                model: model || 'claude-haiku-4',
                messages,
                temperature: config.temperature,
            });

            const content = response.data.choices[0]?.message?.content;

            if (!content) {
                throw new Error('No content in response');
            }

            return content;
        } catch (error: any) {
            console.error('LLM client error:', error.message);
            throw error;
        }
    }

    async searchDocuments(query: string): Promise<{ content: string; score: number }[]> {
        try {
            const response = await this.client.post('/api/v1/documents/search', {
                agentId: config.agentId,
                query,
                limit: 3,
            });

            return response.data.results || [];
        } catch (error: any) {
            console.error('Document search error:', error.message);
            return [];
        }
    }

    buildMessages(
        systemPrompt: string,
        summary: string | null,
        recentMessages: StoredMessage[],
        ragContext: string | null
    ): ChatMessage[] {
        const messages: ChatMessage[] = [];

        // System prompt
        let system = systemPrompt;

        if (summary) {
            system += `\n\n# КРАТКОЕ РЕЗЮМЕ ПРЕДЫДУЩЕГО ДИАЛОГА:\n${summary}`;
        }

        if (ragContext) {
            system += `\n\n# РЕЛЕВАНТНАЯ ИНФОРМАЦИЯ ИЗ БАЗЫ ЗНАНИЙ:\n${ragContext}`;
        }

        messages.push({ role: 'system', content: system });

        // Recent messages
        for (const msg of recentMessages) {
            if (msg.messageType === 'HUMAN') {
                messages.push({ role: 'user', content: msg.content });
            } else if (msg.messageType === 'AI') {
                messages.push({ role: 'assistant', content: msg.content });
            }
        }

        return messages;
    }
}

export const llmClient = new LLMClient();
