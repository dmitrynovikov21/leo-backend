/**
 * Chat Service
 * Handles chat processing for manual testing API
 * Replicates agent-runtime bot.ts logic for HTTP access
 */

import { query, queryOne } from '../db';
import { litellmService, ChatMessage } from './litellm.service';
import { hybridSearchService } from './hybrid-search.service';

export type MessageType = 'HUMAN' | 'AI' | 'SYSTEM';

interface StoredMessage {
    id: string;
    agentId: string;
    sessionId: string;
    messageType: MessageType;
    content: string;
    createdAt: Date;
}

interface MemoryContext {
    recentMessages: StoredMessage[];
    summary: string | null;
}

const MAX_MESSAGES = 20;
const KEEP_MESSAGES = 10;

function generateId(): string {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 10);
    return `c${timestamp}${randomPart}`;
}

function generateSessionId(isTest: boolean): string {
    const prefix = isTest ? 'test_' : 'session_';
    return prefix + generateId();
}

// Session ID is stored in telegram_user_id field as string hash
function sessionToUserId(sessionId: string): number {
    // Convert session string to a stable numeric ID
    let hash = 0;
    for (let i = 0; i < sessionId.length; i++) {
        const char = sessionId.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    // Make it positive and add offset for test sessions
    return Math.abs(hash) + (sessionId.startsWith('test_') ? 1_000_000_000 : 0);
}

class ChatService {

    async getAgentConfig(agentId: string): Promise<{ systemPrompt: string; name: string; temperature: number } | null> {
        const agent = await queryOne<{
            systemPrompt: string;
            name: string;
            display_name: string | null;
            temperature: number;
            tone: string[] | null;
            guardrails: { id: string; rule: string }[] | null;
        }>(
            `SELECT "systemPrompt", name, display_name, temperature, tone, guardrails FROM agents WHERE id = $1`,
            [agentId]
        );

        if (!agent) return null;

        // Build full system prompt with behavior settings
        let fullPrompt = agent.systemPrompt || 'You are a helpful assistant.';

        // Prepend identity instruction if displayName is set
        if (agent.display_name) {
            fullPrompt = `Ты — ${agent.display_name}.\n\n${fullPrompt}`;
        }

        // Add tone instructions
        if (agent.tone && agent.tone.length > 0) {
            fullPrompt += `\n\n## ТОН ОБЩЕНИЯ\nИспользуй следующий тон в общении: ${agent.tone.join(', ')}.`;
        }

        // Add guardrails as strict rules
        if (agent.guardrails && agent.guardrails.length > 0) {
            fullPrompt += `\n\n## ОГРАНИЧЕНИЯ (СТРОГО СОБЛЮДАЙ)\n`;
            for (const g of agent.guardrails) {
                fullPrompt += `- ${g.rule}\n`;
            }
        }

        return {
            systemPrompt: fullPrompt,
            name: agent.name,
            temperature: agent.temperature ?? 0.5,
        };
    }

    async saveMessage(agentId: string, sessionId: string, messageType: MessageType, content: string): Promise<void> {
        const id = generateId();
        const numericUserId = sessionToUserId(sessionId);

        await query(
            `INSERT INTO agent_messages (id, "agentId", telegram_user_id, message_type, content, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [id, agentId, numericUserId, messageType, content]
        );
    }

    async getRecentMessages(agentId: string, sessionId: string, limit: number = MAX_MESSAGES): Promise<StoredMessage[]> {
        const numericUserId = sessionToUserId(sessionId);

        const messages = await query<{
            id: string;
            agentId: string;
            telegram_user_id: string;
            message_type: MessageType;
            content: string;
            created_at: Date;
        }>(
            `SELECT id, "agentId", telegram_user_id, message_type, content, created_at
             FROM agent_messages
             WHERE "agentId" = $1 AND telegram_user_id = $2
             ORDER BY created_at DESC
             LIMIT $3`,
            [agentId, numericUserId, limit]
        );

        return messages.reverse().map(m => ({
            id: m.id,
            agentId: m.agentId,
            sessionId: sessionId,
            messageType: m.message_type,
            content: m.content,
            createdAt: m.created_at,
        }));
    }

    async getLatestSummary(agentId: string, sessionId: string): Promise<string | null> {
        const numericUserId = sessionToUserId(sessionId);

        const result = await queryOne<{ summary: string }>(
            `SELECT summary FROM agent_summaries
             WHERE "agentId" = $1 AND telegram_user_id = $2
             ORDER BY created_at DESC LIMIT 1`,
            [agentId, numericUserId]
        );

        return result?.summary || null;
    }

    async getMemoryContext(agentId: string, sessionId: string): Promise<MemoryContext> {
        const recentMessages = await this.getRecentMessages(agentId, sessionId, KEEP_MESSAGES);
        const summary = await this.getLatestSummary(agentId, sessionId);
        return { recentMessages, summary };
    }

    async searchDocuments(agentId: string, queryText: string): Promise<string | null> {
        try {
            const results = await hybridSearchService.searchWithFallback(agentId, queryText, 3);

            if (results.length === 0) return null;

            return results
                .map((r, i) => `[${i + 1}] ${r.content}`)
                .join('\n\n');
        } catch (error) {
            console.error('Hybrid search error:', error);
            return null;
        }
    }

    buildMessages(
        systemPrompt: string,
        summary: string | null,
        recentMessages: StoredMessage[],
        ragContext: string | null
    ): ChatMessage[] {
        const messages: ChatMessage[] = [];

        let system = systemPrompt;

        if (summary) {
            system += `\n\n# КРАТКОЕ РЕЗЮМЕ ПРЕДЫДУЩЕГО ДИАЛОГА:\n${summary}`;
        }

        if (ragContext) {
            system += `\n\n# РЕЛЕВАНТНАЯ ИНФОРМАЦИЯ ИЗ БАЗЫ ЗНАНИЙ:\n${ragContext}`;
        }

        messages.push({ role: 'system', content: system });

        for (const msg of recentMessages) {
            if (msg.messageType === 'HUMAN') {
                messages.push({ role: 'user', content: msg.content });
            } else if (msg.messageType === 'AI') {
                messages.push({ role: 'assistant', content: msg.content });
            }
        }

        return messages;
    }

    async processMessage(
        agentId: string,
        sessionId: string | null,
        message: string,
        isTest: boolean = true
    ): Promise<{ sessionId: string; response: string; timestamp: string }> {
        // Generate session if not provided
        const finalSessionId = sessionId || generateSessionId(isTest);

        // Get agent config
        const agentConfig = await this.getAgentConfig(agentId);
        if (!agentConfig) {
            throw new Error(`Agent ${agentId} not found`);
        }

        // Save user message
        await this.saveMessage(agentId, finalSessionId, 'HUMAN', message);

        // Get memory context
        const memoryContext = await this.getMemoryContext(agentId, finalSessionId);

        // Search documents (RAG)
        const ragContext = await this.searchDocuments(agentId, message);
        if (ragContext) {
            console.log(`📚 [${agentId}] Found relevant documents for test session`);
        }

        // Build chat messages
        const chatMessages = this.buildMessages(
            agentConfig.systemPrompt,
            memoryContext.summary,
            memoryContext.recentMessages,
            ragContext
        );

        // Note: current message is already in recentMessages (saved above)

        // Get LLM response
        const response = await litellmService.chatCompletion({
            model: 'claude-haiku-4',
            messages: chatMessages,
            temperature: agentConfig.temperature,
        });

        const aiResponse = response.choices[0]?.message?.content || 'No response';

        // Save AI response
        await this.saveMessage(agentId, finalSessionId, 'AI', aiResponse);

        return {
            sessionId: finalSessionId,
            response: aiResponse,
            timestamp: new Date().toISOString(),
        };
    }

    async resetSession(agentId: string, sessionId?: string): Promise<{ sessionId: string; message: string }> {
        if (sessionId) {
            const numericUserId = sessionToUserId(sessionId);

            // Delete messages
            await query(
                `DELETE FROM agent_messages WHERE "agentId" = $1 AND telegram_user_id = $2`,
                [agentId, numericUserId]
            );

            // Delete summaries
            await query(
                `DELETE FROM agent_summaries WHERE "agentId" = $1 AND telegram_user_id = $2`,
                [agentId, numericUserId]
            );
        }

        // Generate new session
        const newSessionId = generateSessionId(true);

        return {
            sessionId: newSessionId,
            message: sessionId ? 'Session reset successfully' : 'New session created',
        };
    }
}

export const chatService = new ChatService();
