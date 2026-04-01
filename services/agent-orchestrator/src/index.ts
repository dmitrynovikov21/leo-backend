import express from 'express';
import cors from 'cors';
import { config } from './config';
import { pool } from './db';

import agentsRoutes from './routes/agents.routes';
import behaviorRoutes from './routes/behavior.routes';
import scheduleRoutes from './routes/schedule.routes';
import notesRoutes from './routes/notes.routes';
import quizPromptRoutes from './routes/quiz-prompt.routes';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// API Key auth middleware
function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (!config.apiSecret) {
        return next();
    }
    const provided = req.headers['x-api-secret'] as string;
    if (provided !== config.apiSecret) {
        return res.status(401).json({ error: 'Unauthorized: invalid or missing API key' });
    }
    next();
}

// Health check (no auth required)
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', service: 'agent-orchestrator' });
    } catch (error) {
        res.status(503).json({ status: 'error', message: 'Database connection failed' });
    }
});

// All routes require API key
app.use(requireApiKey);
app.use('/api/v1/agents', agentsRoutes);
app.use('/api/v1/agents', behaviorRoutes);
app.use('/api/v1/agents', scheduleRoutes);
app.use('/api/v1/agents', notesRoutes);
app.use('/api/v1', quizPromptRoutes);

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(config.port, () => {
    console.log(`🚀 agent-orchestrator running on port ${config.port}`);
    console.log(`📡 Gateway URL: ${config.gatewayUrl}`);
    console.log(`🐳 Agent Image: ${config.agentImage}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down...');
    await pool.end();
    process.exit(0);
});
