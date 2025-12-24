import { query, queryOne } from '../db';
import { config } from '../config';
import axios from 'axios';

export type MessageType = 'HUMAN' | 'AI' | 'TOOL' | 'SYSTEM';

export interface StoredMessage {
    id: string;
    agentId: string;
    telegramUserId: bigint;
    messageType: MessageType;
    content: string;
    createdAt: Date;
}

export interface MemoryContext {
    recentMessages: StoredMessage[];
    summary: string | null;
}

function generateCuid(): string {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 10);
    return `c${timestamp}${randomPart}`;
}

export class MemoryManager {
    private agentId: string;

    constructor(agentId: string) {
        this.agentId = agentId;
    }

    async saveMessage(telegramUserId: number, messageType: MessageType, content: string): Promise<void> {
        const id = generateCuid();

        await query(
            `INSERT INTO agent_messages (id, "agentId", telegram_user_id, message_type, content, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
            [id, this.agentId, telegramUserId, messageType, content]
        );

        // Check if we need to summarize
        await this.checkAndSummarize(telegramUserId);
    }

    async getRecentMessages(telegramUserId: number, limit: number = 20): Promise<StoredMessage[]> {
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
            [this.agentId, telegramUserId, limit]
        );

        return messages.reverse().map(m => ({
            id: m.id,
            agentId: m.agentId,
            telegramUserId: BigInt(m.telegram_user_id),
            messageType: m.message_type,
            content: m.content,
            createdAt: m.created_at,
        }));
    }

    async getLatestSummary(telegramUserId: number): Promise<string | null> {
        const result = await queryOne<{ summary: string }>(
            `SELECT summary FROM agent_summaries
       WHERE "agentId" = $1 AND telegram_user_id = $2
       ORDER BY created_at DESC LIMIT 1`,
            [this.agentId, telegramUserId]
        );

        return result?.summary || null;
    }

    async getContextForPrompt(telegramUserId: number): Promise<MemoryContext> {
        const recentMessages = await this.getRecentMessages(telegramUserId, config.keepMessages);
        const summary = await this.getLatestSummary(telegramUserId);

        return { recentMessages, summary };
    }

    private async checkAndSummarize(telegramUserId: number): Promise<void> {
        // Count messages for this user
        const countResult = await queryOne<{ count: string }>(
            `SELECT COUNT(*) as count FROM agent_messages
       WHERE "agentId" = $1 AND telegram_user_id = $2`,
            [this.agentId, telegramUserId]
        );

        const count = parseInt(countResult?.count || '0', 10);

        if (count >= config.maxMessages) {
            console.log(`📊 Message count ${count} >= ${config.maxMessages}, triggering summarization`);
            await this.summarizeAndCleanup(telegramUserId);
        }
    }

    private async summarizeAndCleanup(telegramUserId: number): Promise<void> {
        // Get all messages to summarize
        const messages = await this.getRecentMessages(telegramUserId, config.maxMessages);

        if (messages.length < config.maxMessages) {
            return;
        }

        // Get existing summary
        const existingSummary = await this.getLatestSummary(telegramUserId);

        // Prepare conversation text for summarization
        const conversationText = messages.map(m => {
            const role = m.messageType === 'HUMAN' ? 'User' : 'Assistant';
            return `${role}: ${m.content}`;
        }).join('\n');

        // Call Claude for summarization via gateway
        try {
            const response = await axios.post(`${config.gatewayUrl}/api/v1/chat/completions`, {
                userId: config.userId,
                model: 'claude-haiku-4',
                messages: [
                    {
                        role: 'system',
                        content: `Ты — ассистент для суммаризации диалогов. 
Создай краткое резюме диалога, сохраняя:
- Ключевые темы и вопросы пользователя
- Важные факты и решения
- Контекст для продолжения беседы

Формат: 2-3 абзаца, на русском языке.
${existingSummary ? `\n\nПредыдущее резюме:\n${existingSummary}` : ''}`,
                    },
                    {
                        role: 'user',
                        content: `Суммаризируй этот диалог:\n\n${conversationText}`,
                    },
                ],
            });

            const summary = response.data.choices?.[0]?.message?.content;

            if (summary) {
                // Save new summary
                const summaryId = generateCuid();
                await query(
                    `INSERT INTO agent_summaries (id, "agentId", telegram_user_id, summary, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
                    [summaryId, this.agentId, telegramUserId, summary]
                );

                // Delete old messages (keep last keepMessages)
                const messagesToKeep = messages.slice(-config.keepMessages);
                const idsToKeep = messagesToKeep.map(m => m.id);

                if (idsToKeep.length > 0) {
                    await query(
                        `DELETE FROM agent_messages 
             WHERE "agentId" = $1 AND telegram_user_id = $2 
             AND id NOT IN (${idsToKeep.map((_, i) => `$${i + 3}`).join(', ')})`,
                        [this.agentId, telegramUserId, ...idsToKeep]
                    );
                }

                console.log(`✅ Summarized and cleaned up. Kept ${idsToKeep.length} messages.`);
            }
        } catch (error: any) {
            console.error('Summarization error:', error.message);
        }
    }

    async clearHistory(telegramUserId: number): Promise<void> {
        await query(
            `DELETE FROM agent_messages WHERE "agentId" = $1 AND telegram_user_id = $2`,
            [this.agentId, telegramUserId]
        );
        await query(
            `DELETE FROM agent_summaries WHERE "agentId" = $1 AND telegram_user_id = $2`,
            [this.agentId, telegramUserId]
        );
    }
}
