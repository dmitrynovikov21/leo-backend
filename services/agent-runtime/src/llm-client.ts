import axios, { AxiosInstance } from 'axios';
import { config } from './config';
import { MemoryManager, StoredMessage } from './memory/manager';
import { agentTools, executeReportConflict, ReportConflictParams } from './tools';

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
}

export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export interface ChatCompletionResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: {
        index: number;
        message: {
            role: string;
            content: string | null;
            tool_calls?: ToolCall[];
        };
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

    /**
     * Execute a tool call and return the result
     */
    private async executeTool(toolCall: ToolCall, chatId?: string): Promise<string> {
        const { name, arguments: argsStr } = toolCall.function;

        try {
            const args = JSON.parse(argsStr);

            switch (name) {
                case 'report_conflict':
                    return await executeReportConflict(args as ReportConflictParams, chatId);
                default:
                    return `Unknown tool: ${name}`;
            }
        } catch (error: any) {
            console.error(`Tool execution error (${name}):`, error.message);
            return `Tool error: ${error.message}`;
        }
    }

    /**
     * Chat with tool support - handles tool calls automatically
     */
    async chat(messages: ChatMessage[], model?: string, chatId?: string): Promise<string> {
        try {
            // First request with tools
            const response = await this.client.post<ChatCompletionResponse>('/api/v1/chat/completions', {
                userId: config.userId,
                agentId: config.agentId,
                model: model || 'claude-haiku-4',
                messages,
                temperature: config.temperature,
                tools: agentTools,
                tool_choice: 'auto',
            });

            const choice = response.data.choices[0];

            // Check if LLM wants to call tools
            if (choice.finish_reason === 'tool_calls' || choice.message.tool_calls) {
                const toolCalls = choice.message.tool_calls || [];

                console.log(`🔧 LLM requested ${toolCalls.length} tool call(s)`);

                // Add assistant message with tool calls
                const assistantMessage: ChatMessage = {
                    role: 'assistant',
                    content: choice.message.content,
                    tool_calls: toolCalls,
                };

                const updatedMessages = [...messages, assistantMessage];

                // Execute each tool and add results
                for (const toolCall of toolCalls) {
                    console.log(`   Executing: ${toolCall.function.name}`);
                    const result = await this.executeTool(toolCall, chatId);

                    updatedMessages.push({
                        role: 'tool',
                        content: result,
                        tool_call_id: toolCall.id,
                    });
                }

                // Continue conversation with tool results
                const followUpResponse = await this.client.post<ChatCompletionResponse>('/api/v1/chat/completions', {
                    userId: config.userId,
                    agentId: config.agentId,
                    model: model || 'claude-haiku-4',
                    messages: updatedMessages,
                    temperature: config.temperature,
                    tools: agentTools, // Anthropic requires tools param in follow-up calls
                });

                const finalContent = followUpResponse.data.choices[0]?.message?.content;

                if (!finalContent) {
                    throw new Error('No content in follow-up response');
                }

                return finalContent;
            }

            // No tool calls, return content directly
            const content = choice.message?.content;

            if (!content) {
                throw new Error('No content in response');
            }

            return content;
        } catch (error: any) {
            console.error('LLM client error:', error.message);
            throw error;
        }
    }

    async searchDocuments(query: string): Promise<{ content: string; score: number; metadata?: any }[]> {
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
