import { Bot, Context } from 'grammy';
import { config } from './config';
import { llmClient } from './llm-client';
import { MemoryManager } from './memory/manager';
import { scheduleChecker } from './schedule-checker';
import { queryOne } from './db';

function stripContextPrefix(text: string): string {
    const prefix = '[CONTEXT]: ';
    if (!text.startsWith(prefix)) return text;
    const separatorIndex = text.indexOf('\n\n');
    if (separatorIndex === -1) return text;
    return text.slice(separatorIndex + 2);
}

// Debounce storage: userId -> { timeout, messages[] }
const pendingMessages = new Map<number, {
    timeout: NodeJS.Timeout;
    messages: string[];
    ctx: Context;
}>();

const memoryManager = new MemoryManager(config.agentId);

import { promptService } from './services/prompt.service';

/**
 * Build the full system prompt by combining base prompt with behavior settings
 */
async function buildFullSystemPrompt(): Promise<string> {
    // Start with platform core prompt
    const platformCore = await promptService.getPrompt('platform_core');
    let prompt = platformCore;

    // Add agent-specific system prompt
    if (config.systemPrompt) {
        prompt += `\n\n${config.systemPrompt}`;
    }

    // Prepend identity instruction if displayName is set
    if (config.identityInstruction) {
        prompt = `${config.identityInstruction}\n\n${prompt}`;
    }

    // Add tone instructions
    if (config.tone.length > 0) {
        prompt += `\n\n## ТОН ОБЩЕНИЯ\nТвой тон: ${config.tone.join(', ')}. Поддерживай этот стиль во всех ответах. Не переключайся на другой тон даже если клиент грубит.`;
    }

    // Add guardrails as strict rules
    if (config.guardrails.length > 0) {
        prompt += `\n\n## ОГРАНИЧЕНИЯ (СТРОГО СОБЛЮДАЙ)\n`;
        for (const g of config.guardrails) {
            prompt += `- ${g.rule}\n`;
        }
    }

    // Add conflict detection protocol from DB
    const conflictProtocol = await promptService.getPrompt('conflict_detection_protocol');
    if (conflictProtocol) {
        prompt += `\n\n${conflictProtocol}`;
    }

    return prompt;
}

// Cache for the full system prompt (initialized on first use)
let fullSystemPrompt: string | null = null;

async function getFullSystemPrompt(): Promise<string> {
    if (fullSystemPrompt === null) {
        fullSystemPrompt = await buildFullSystemPrompt();
        console.log('✅ System prompt initialized from DB');
    }
    return fullSystemPrompt;
}

async function processMessages(userId: number, messages: string[], ctx: Context): Promise<void> {
    const combinedMessage = messages.join('\n');

    console.log(`📨 Processing ${messages.length} message(s) from user ${userId}`);

    try {
        // Check if within working hours
        const scheduleInfo = await scheduleChecker.checkSchedule();
        if (!scheduleInfo.isWorking) {
            console.log(`🚫 Bot is offline, sending offline message`);
            await ctx.reply(scheduleInfo.offlineMessage || 'Сейчас нерабочее время.');
            return;
        }

        // Save human message
        await memoryManager.saveMessage(userId, 'HUMAN', combinedMessage);

        // Get memory context
        const memoryContext = await memoryManager.getContextForPrompt(userId);

        // Search documents for RAG
        let ragContext: string | null = null;
        const searchResults = await llmClient.searchDocuments(combinedMessage);

        if (searchResults.length > 0) {
            ragContext = searchResults
                .map((r, i) => {
                    const id = r.metadata?.knowledgeBaseId || r.metadata?.id || 'unknown';
                    const filename = r.metadata?.source || r.metadata?.filename || 'Unknown File';

                    const cleanContent = stripContextPrefix(r.content);

                    return `DOCUMENT [${i + 1}]
File ID: ${id}
Filename: ${filename}
Content: ${cleanContent}`;
                })
                .join('\n\n---\n\n');
            console.log(`📚 Found ${searchResults.length} relevant documents`);
        }

        // Get schedule description for system prompt
        const scheduleDescription = await scheduleChecker.getScheduleDescription();
        let enrichedPrompt = await getFullSystemPrompt();
        if (scheduleDescription) {
            enrichedPrompt += '\n\n' + scheduleDescription;
        }

        // Build messages with context
        const chatMessages = llmClient.buildMessages(
            enrichedPrompt,
            memoryContext.summary,
            memoryContext.recentMessages,
            ragContext
        );

        // Add current message
        chatMessages.push({ role: 'user', content: combinedMessage });

        // Show typing indicator
        await ctx.replyWithChatAction('typing');

        // Get response
        const response = await llmClient.chat(chatMessages);

        // Save AI message
        await memoryManager.saveMessage(userId, 'AI', response);

        // Send response
        await ctx.reply(response, {
            parse_mode: 'Markdown',
        }).catch(async () => {
            // If markdown fails, send as plain text
            await ctx.reply(response);
        });

    } catch (error: any) {
        console.error('Error processing message:', error.message);
        await ctx.reply('⚠️ Произошла ошибка при обработке сообщения. Попробуйте позже.');
    }
}

function scheduleProcessing(userId: number, message: string, ctx: Context): void {
    const existing = pendingMessages.get(userId);

    if (existing) {
        // Clear existing timeout and add message
        clearTimeout(existing.timeout);
        existing.messages.push(message);
        existing.ctx = ctx; // Update context to latest
    } else {
        pendingMessages.set(userId, {
            timeout: null as any,
            messages: [message],
            ctx,
        });
    }

    // Set new timeout
    const pending = pendingMessages.get(userId)!;
    pending.timeout = setTimeout(async () => {
        const data = pendingMessages.get(userId);
        if (data) {
            pendingMessages.delete(userId);
            await processMessages(userId, data.messages, data.ctx);
        }
    }, config.debounceMs);
}

export function createBot(): Bot<Context> {
    const bot = new Bot(config.telegramBotToken);

    // Start command
    bot.command('start', async (ctx) => {
        // Use custom welcome message if set, otherwise generate default
        const welcomeMessage = config.welcomeMessage || `👋 Привет! Я ${config.agentName}.

Я готов помочь тебе. Просто напиши мне сообщение, и я отвечу!

⏱️ Я подожду ${config.debounceMs / 1000} секунд после твоего последнего сообщения, чтобы ты мог дописать мысль.

/clear - очистить историю диалога
/help - показать это сообщение`;

        await ctx.reply(welcomeMessage);
    });

    // Help command
    bot.command('help', async (ctx) => {
        await ctx.reply(`🤖 ${config.agentName}

Доступные команды:
/start - начать диалог
/clear - очистить историю диалога
/help - показать эту справку

💡 Я жду ${config.debounceMs / 1000} сек. после последнего сообщения, прежде чем отвечать.
Это позволяет тебе писать несколько сообщений подряд.`);
    });

    // Clear conversation history
    bot.command('clear', async (ctx) => {
        const userId = ctx.from?.id;
        if (userId) {
            await memoryManager.clearHistory(userId);
        }
        await ctx.reply('🗑️ История диалога очищена.');
    });

    // Handle text messages with debounce
    bot.on('message:text', async (ctx) => {
        const userId = ctx.from?.id;
        const userMessage = ctx.message.text;

        if (!userId) return;

        // Schedule message processing with debounce
        scheduleProcessing(userId, userMessage, ctx);

        console.log(`📝 Message queued from user ${userId}, waiting ${config.debounceMs}ms...`);
    });

    // Handle errors
    bot.catch((err) => {
        console.error('Bot error:', err);
    });

    return bot;
}
