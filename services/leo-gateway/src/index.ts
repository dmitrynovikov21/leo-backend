import express from 'express';
import cors from 'cors';
import { config } from './config';
import { pool } from './db';

import chatRoutes from './routes/chat.routes';
import personaRoutes from './routes/persona.routes';
import usageRoutes from './routes/usage.routes';
import agentPromptRoutes from './routes/agent-prompt.routes';
import documentsRoutes from './routes/documents.routes';

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health check
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', service: 'leo-gateway' });
    } catch (error) {
        res.status(503).json({ status: 'error', message: 'Database connection failed' });
    }
});

// Routes
app.use('/api/v1/chat', chatRoutes);
app.use('/api/v1/generate-persona', personaRoutes);
app.use('/api/v1/usage', usageRoutes);
app.use('/api/v1/generate-agent-prompt', agentPromptRoutes);
app.use('/api/v1/documents', documentsRoutes);

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(config.port, () => {
    console.log(`🚀 leo-gateway running on port ${config.port}`);
    console.log(`📡 LiteLLM URL: ${config.litellmUrl}`);
    console.log(`🗄️ Chroma URL: ${config.chromaUrl}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down...');
    await pool.end();
    process.exit(0);
});
