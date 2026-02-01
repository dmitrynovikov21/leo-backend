/**
 * Chat Service
 * Handles chat processing for manual testing API
 * Replicates agent-runtime bot.ts logic for HTTP access
 */

import { query, queryOne } from '../db';
import { litellmService, ChatMessage, ToolCall } from './litellm.service';
import { hybridSearchService } from './hybrid-search.service';
import { promptService } from './prompt.service';
import { agentTools, executeReportConflict, ReportConflictParams } from './agent-tools.service';

export type MessageType = 'HUMAN' | 'AI' | 'SYSTEM' | 'TOOL';

interface StoredMessage {
    id: string;
    agentId: string;
    sessionId: string;
    messageType: string; // broadened from MessageType to support tool messages
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
        // Start with platform-level instructions
        let fullPrompt = await promptService.getPrompt('platform_core');

        // Add agent identity
        if (agent.display_name) {
            fullPrompt += `\n\nТы — ${agent.display_name}.`;
        }

        // Add agent-specific system prompt
        if (agent.systemPrompt) {
            fullPrompt += `\n\n${agent.systemPrompt}`;
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

        // Add conflict detection protocol
        fullPrompt += `\n\n${await promptService.getPrompt('conflict_detection_protocol')}`;

        return {
            systemPrompt: fullPrompt,
            name: agent.name,
            temperature: agent.temperature ?? 0.5,
        };
    }

    async saveMessage(agentId: string, sessionId: string, messageType: string, content: string | null, isTest: boolean = false): Promise<void> {
        const id = generateId();
        const numericUserId = sessionToUserId(sessionId);

        // Store null content as empty string for DB safety 
        // (though in reality we might want to support nulls or JSON for tool calls)
        const safeContent = content || '';

        await query(
            `INSERT INTO agent_messages (id, agent_id, telegram_user_id, message_type, content, is_test, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [id, agentId, numericUserId, messageType, safeContent, isTest]
        );
    }

    async getRecentMessages(agentId: string, sessionId: string, limit: number = MAX_MESSAGES): Promise<StoredMessage[]> {
        const numericUserId = sessionToUserId(sessionId);

        const messages = await query<{
            id: string;
            agent_id: string;
            telegram_user_id: string;
            message_type: string;
            content: string;
            created_at: Date;
        }>(
            `SELECT id, agent_id, telegram_user_id, message_type, content, created_at
             FROM agent_messages
             WHERE agent_id = $1 AND telegram_user_id = $2
               -- Exclude tool messages from simple history for now as chat UI might not support them yet
               AND message_type IN ('HUMAN', 'AI') 
             ORDER BY created_at DESC
             LIMIT $3`,
            [agentId, numericUserId, limit]
        );

        return messages.reverse().map(m => ({
            id: m.id,
            agentId: m.agent_id,
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
             WHERE agent_id = $1 AND telegram_user_id = $2
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
            const results = await hybridSearchService.searchWithFallback(agentId, queryText, 300);

            if (results.length === 0) return null;

            return results
                .map((r, i) => {
                    const id = r.metadata?.knowledgeBaseId || r.metadata?.id || 'unknown';
                    const filename = r.metadata?.source || r.metadata?.filename || 'Unknown File';

                    return `<document index="${i + 1}" id="${id}" filename="${filename}">
${r.content}
</document>`;
                })
                .join('\n\n');
        } catch (error) {
            console.error('Hybrid search error:', error);
            return null;
        }
    }

    /**
     * Get all notes for an agent (for priority injection)
     * Notes are added at the END of the prompt for recency bias
     */
    async getAgentNotes(agentId: string): Promise<string | null> {
        try {
            const notes = await query<{ id: string; title: string; content: string }>(
                `SELECT id, title, content FROM agent_notes WHERE agent_id = $1 ORDER BY updated_at DESC`,
                [agentId]
            );

            if (notes.length === 0) return null;

            return notes
                .map(n => `NOTE
Note ID: ${n.id}
Title: ${n.title}
Content: ${n.content}`)
                .join('\n\n---\n\n');
        } catch (error) {
            console.error('Get notes error:', error);
            return null;
        }
    }

    buildMessages(
        systemPrompt: string,
        summary: string | null,
        recentMessages: StoredMessage[],
        ragContext: string | null,
        notesContext: string | null = null
    ): ChatMessage[] {
        const messages: ChatMessage[] = [];

        let system = systemPrompt;

        if (summary) {
            system += `\n\n# КРАТКОЕ РЕЗЮМЕ ПРЕДЫДУЩЕГО ДИАЛОГА:\n${summary}`;
        }

        // RAG context from files (lower priority)
        if (ragContext) {
            system += `\n\n# РЕЛЕВАНТНАЯ ИНФОРМАЦИЯ ИЗ БАЗЫ ЗНАНИЙ:\n<known_information>\n${ragContext}\n</known_information>`;
        }

        // Notes at the END for recency bias (HIGH PRIORITY)
        if (notesContext) {
            system += `\n\n# IMPORTANT UPDATES (High Priority):\n${notesContext}`;
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

    private async executeTool(agentId: string, sessionId: string, toolCall: ToolCall): Promise<string> {
        const { name, arguments: argsStr } = toolCall.function;

        try {
            const args = JSON.parse(argsStr);

            switch (name) {
                case 'report_conflict':
                    // Pass chatId (which is sessionId here) to log conflict properly
                    return await executeReportConflict(agentId, args as ReportConflictParams, sessionId);
                default:
                    return `Unknown tool: ${name}`;
            }
        } catch (error: any) {
            console.error(`Tool execution error (${name}):`, error.message);
            return `Tool error: ${error.message}`;
        }
    }

    async processMessage(
        agentId: string,
        sessionId: string | null,
        message: string,
        explicitUserId?: string, // New optional parameter
        isTest: boolean = true
    ): Promise<{ sessionId: string; response: string; timestamp: string }> {
        // Generate session if not provided
        const finalSessionId = sessionId || generateSessionId(isTest);

        // Determine user ID for logging/tracking
        // Use explicit userId if provided, otherwise fallback to session ID
        const trackingUserId = explicitUserId || finalSessionId;

        // Get agent config
        const agentConfig = await this.getAgentConfig(agentId);
        if (!agentConfig) {
            throw new Error(`Agent ${agentId} not found`);
        }

        // Save user message
        await this.saveMessage(agentId, finalSessionId, 'HUMAN', message, isTest);

        // Get memory context
        const memoryContext = await this.getMemoryContext(agentId, finalSessionId);

        // Search documents (RAG)
        const ragContext = await this.searchDocuments(agentId, message);
        if (ragContext) {
            console.log(`📚 [${agentId}] Found relevant documents for test session`);
        }

        // Get agent notes
        const notesContext = await this.getAgentNotes(agentId);
        if (notesContext) {
            console.log(`📝 [${agentId}] Found notes for priority injection`);
        }

        // Build chat messages
        const chatMessages = this.buildMessages(
            agentConfig.systemPrompt,
            memoryContext.summary,
            memoryContext.recentMessages,
            ragContext,
            notesContext
        );

        // Add current user message
        chatMessages.push({ role: 'user', content: message });

        // First LLM Call with tools
        const response = await litellmService.chatCompletion({
            userId: trackingUserId,
            agentId: agentId,
            model: 'claude-haiku-4',
            messages: chatMessages,
            temperature: agentConfig.temperature,
            tools: agentTools,
            tool_choice: 'auto',
        });

        const choice = response.choices[0];
        let aiResponse = choice.message?.content || '';

        // Handle Tool Calls
        if (choice.finish_reason === 'tool_calls' || choice.message.tool_calls) {
            const toolCalls = choice.message.tool_calls || [];
            console.log(`🔧 [${agentId}] LLM requested ${toolCalls.length} tool call(s) in Gateway`);

            // Add assistant message with tool calls
            const assistantMessage: ChatMessage = {
                role: 'assistant',
                content: choice.message.content,
                tool_calls: toolCalls,
            };

            const updatedMessages = [...chatMessages, assistantMessage];

            // Execute tools
            for (const toolCall of toolCalls) {
                console.log(`   Executing: ${toolCall.function.name}`);
                const result = await this.executeTool(agentId, finalSessionId, toolCall);

                updatedMessages.push({
                    role: 'tool',
                    content: result,
                    tool_call_id: toolCall.id,
                });
            }

            // Follow-up LLM Call
            const followUpResponse = await litellmService.chatCompletion({
                userId: trackingUserId,
                agentId: agentId,
                model: 'claude-haiku-4',
                messages: updatedMessages,
                temperature: agentConfig.temperature,
                tools: agentTools, // Required by Anthropic when tool messages are present
            });

            aiResponse = followUpResponse.choices[0]?.message?.content || 'No response after tools';
        }

        if (!aiResponse && !choice.message.tool_calls) {
            aiResponse = 'No response';
        }

        // Save AI response
        await this.saveMessage(agentId, finalSessionId, 'AI', aiResponse, isTest);

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
                `DELETE FROM agent_messages WHERE agent_id = $1 AND telegram_user_id = $2`,
                [agentId, numericUserId]
            );

            // Delete summaries
            await query(
                `DELETE FROM agent_summaries WHERE agent_id = $1 AND telegram_user_id = $2`,
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
