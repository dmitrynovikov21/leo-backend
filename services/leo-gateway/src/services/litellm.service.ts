import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
}

export interface ChatCompletionRequest {
    model?: string;
    messages: ChatMessage[];
    temperature?: number;
    max_tokens?: number;
    tools?: any[];
    tool_choice?: string;
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

export interface GenerateAgentPromptRequest {
    agentName: string;
    role: string;
    description: string;
}

class LiteLLMService {
    private client: AxiosInstance;
    private promptGeneratorInstruction: string | null = null;

    constructor() {
        this.client = axios.create({
            baseURL: config.litellmUrl,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }

    private getPromptGeneratorInstruction(): string {
        if (this.promptGeneratorInstruction) {
            return this.promptGeneratorInstruction;
        }

        const configPath = path.join(__dirname, '../../config/prompt-generator-instruction.md');

        try {
            this.promptGeneratorInstruction = fs.readFileSync(configPath, 'utf-8');
            return this.promptGeneratorInstruction;
        } catch (error) {
            console.warn('Could not load prompt generator instruction, using default');
            return `Ты — эксперт по созданию персонажей AI-ассистентов. 
Сгенерируй детальный system prompt для AI-ассистента на основе предоставленных данных.
Выведи только system prompt, без пояснений, на русском языке.`;
        }
    }

    async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
        const payload: any = {
            model: request.model || config.defaultLlmModel,
            messages: request.messages,
            temperature: request.temperature ?? 0.7,
            max_tokens: request.max_tokens ?? 2048,
        };

        if (request.tools) {
            payload.tools = request.tools;
            payload.tool_choice = request.tool_choice || 'auto';
        }

        const response = await this.client.post<ChatCompletionResponse>('/chat/completions', payload);

        return response.data;
    }

    async generatePersona(role: string, description: string): Promise<string> {
        const response = await this.chatCompletion({
            model: 'claude-haiku-4',
            messages: [
                {
                    role: 'system',
                    content: `You are an expert at creating AI assistant personas. Generate a detailed system prompt for an AI assistant based on the given role and description. The prompt should define the assistant's personality, communication style, expertise areas, and behavioral guidelines. Output only the system prompt, nothing else.`,
                },
                {
                    role: 'user',
                    content: `Role: ${role}\nDescription: ${description}`,
                },
            ],
            temperature: 0.8,
            max_tokens: 1024,
        });

        // Safe access to content, fallback to empty string if null
        return response.choices[0]?.message?.content || '';
    }

    async generateAgentPrompt(request: GenerateAgentPromptRequest): Promise<string> {
        const instruction = this.getPromptGeneratorInstruction();

        const response = await this.chatCompletion({
            model: config.defaultLlmModel,
            messages: [
                {
                    role: 'system',
                    content: instruction,
                },
                {
                    role: 'user',
                    content: `Название агента: ${request.agentName}
Роль агента: ${request.role}
Описание агента: ${request.description}`,
                },
            ],
            temperature: 0.7,
            max_tokens: 2048,
        });

        // Safe access to content, fallback to empty string if null
        return response.choices[0]?.message?.content || '';
    }
}

export const litellmService = new LiteLLMService();
