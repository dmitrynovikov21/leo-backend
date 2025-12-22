import { createBot } from './bot';
import { config } from './config';
import { pool } from './db';

async function main() {
    console.log(`🤖 Starting agent: ${config.agentName}`);
    console.log(`📋 Agent ID: ${config.agentId}`);
    console.log(`👤 User ID: ${config.userId}`);
    console.log(`📡 Gateway URL: ${config.gatewayUrl}`);
    console.log(`⏱️ Debounce: ${config.debounceMs}ms`);
    console.log(`📊 Max messages: ${config.maxMessages}, keep: ${config.keepMessages}`);

    if (config.langchainTracingV2) {
        console.log(`🔍 LangSmith tracing enabled, project: ${config.langchainProject}`);
    }

    // Start the bot if token is present
    if (config.telegramBotToken && config.telegramBotToken.trim() !== '') {
        console.log('🚀 Bot is starting...');
        const bot = createBot();
        await bot.start({
            onStart: (botInfo) => {
                console.log(`✅ Bot @${botInfo.username} is running!`);
            },
        });
    } else {
        console.log('⚠️ No Telegram token provided. Bot disabled.');
        console.log('🚀 Agent Runtime is active (API/Background mode).');

        // Keep process alive forever
        setInterval(() => { }, 1000 * 60 * 60);
    }
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
