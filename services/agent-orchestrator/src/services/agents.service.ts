import { query, queryOne } from '../db';
import { dockerService, ContainerInfo } from './docker.service';
import { behaviorService } from './behavior.service';

export type AgentStatus = 'STOPPED' | 'STARTING' | 'RUNNING' | 'ERROR';

export interface Agent {
    id: string;
    userId: string;
    name: string;
    role: string;
    description: string;
    systemPrompt: string;
    telegramToken: string | null;
    status: AgentStatus;
    containerId: string | null;
    containerName: string | null;
    created_at: Date;
    updated_at: Date;
}

export interface CreateAgentDto {
    userId: string;
    name: string;
    role: string;
    description: string;
    systemPrompt: string;
    telegramToken?: string;
}

export interface UpdateAgentDto {
    name?: string;
    role?: string;
    description?: string;
    systemPrompt?: string;
    telegramToken?: string;
}

function generateCuid(): string {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 10);
    return `c${timestamp}${randomPart}`;
}

class AgentsService {
    async getAgentsByUser(userId: string): Promise<Agent[]> {
        const agents = await query<Agent>(
            `SELECT * FROM agents WHERE "userId" = $1 ORDER BY created_at DESC`,
            [userId]
        );

        // Sync status for all agents
        // We do this in parallel but be careful with load.
        await Promise.all(agents.map(async (agent) => {
            try {
                const containerInfo = await dockerService.getContainerStatus(agent.id);
                let finalStatus: AgentStatus = 'STOPPED';

                if (containerInfo) {
                    if (containerInfo.status === 'running') finalStatus = 'RUNNING';
                    else if (containerInfo.status === 'restarting') finalStatus = 'STARTING';
                    else if (containerInfo.status === 'error') finalStatus = 'ERROR';
                    else finalStatus = 'STOPPED';
                }

                if (agent.status !== finalStatus) {
                    // Update DB asynchronously if needed, but here we just update the object to return fast?
                    // Better to update DB so next time it's correct.
                    // But we don't await the DB update to speed up response? 
                    // No, let's await to be clean.
                    if (agent.status !== finalStatus) {
                        // Only update if changed
                        await this.updateAgentStatus(agent.id, finalStatus);
                        agent.status = finalStatus;
                    }
                }
            } catch (e) {
                // ignore
            }
        }));

        return agents;
    }

    async getAgentById(id: string): Promise<Agent | null> {
        let agent = await queryOne<Agent>(`SELECT * FROM agents WHERE id = $1`, [id]);
        if (!agent) return null;

        // Fetch live container status
        try {
            const containerInfo = await dockerService.getContainerStatus(id);
            if (containerInfo) {
                // If container is running but DB says stopped, or vice versa, update DB logic? 
                // Or just return the live status to user?
                // User wants "1 in 1 status". So we should return what Docker says.
                // We also update DB to keep it somewhat in sync, but return value is priority.
                const liveStatus = containerInfo.status; // 'running', 'exited', 'restarting', etc.

                // Map Docker status to AgentStatus if possible, or just use string?
                // AgentStatus is enum: 'STOPPED' | 'STARTING' | 'RUNNING' | 'ERROR';
                // Docker status: 'created', 'restarting', 'running', 'removing', 'paused', 'exited', 'dead'

                // We will cast string to any or update type definition. 
                // However, user wants "1 in 1". 
                // Let's rely on what we send to frontend.
                // If we want consistency, we should update the DB status too.

                let mappedStatus: AgentStatus = 'STOPPED';
                if (liveStatus === 'running') mappedStatus = 'RUNNING';
                else if (liveStatus === 'restarting') mappedStatus = 'STARTING'; // or keep as is?
                else if (liveStatus === 'exited' || liveStatus === 'dead') mappedStatus = 'STOPPED';
                else mappedStatus = 'ERROR';

                // But user complained: "I closed container, status remained RUNNING".
                // So if container is gone or exited, we must set STOPPED.

                // Actually, if we want "1 to 1", maybe we should return the raw docker status?
                // But the interface Agent defines status as AgentStatus.
                // Let's stick to syncing the DB and returning the mapped status derived from real container.

                if (agent.status !== mappedStatus) {
                    await this.updateAgentStatus(id, mappedStatus);
                    agent.status = mappedStatus;
                }
            } else {
                // Container not found
                if (agent.status === 'RUNNING' || agent.status === 'STARTING') {
                    await this.updateAgentStatus(id, 'STOPPED');
                    agent.status = 'STOPPED';
                }
            }
        } catch (e) {
            // ignore error, return last known db status
        }

        return agent;
    }

    async createAgent(dto: CreateAgentDto): Promise<Agent> {
        const id = generateCuid();
        const now = new Date();

        await query(
            `INSERT INTO agents (id, "userId", name, role, description, "systemPrompt", "telegramToken", status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'STOPPED', $8, $8)`,
            [id, dto.userId, dto.name, dto.role, dto.description, dto.systemPrompt, dto.telegramToken || null, now]
        );

        return this.getAgentById(id) as Promise<Agent>;
    }

    async updateAgent(id: string, dto: UpdateAgentDto): Promise<Agent | null> {
        const updates: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        if (dto.name !== undefined) {
            updates.push(`name = $${paramIndex++}`);
            values.push(dto.name);
        }
        if (dto.role !== undefined) {
            updates.push(`role = $${paramIndex++}`);
            values.push(dto.role);
        }
        if (dto.description !== undefined) {
            updates.push(`description = $${paramIndex++}`);
            values.push(dto.description);
        }
        if (dto.systemPrompt !== undefined) {
            updates.push(`"systemPrompt" = $${paramIndex++}`);
            values.push(dto.systemPrompt);
        }
        if (dto.telegramToken !== undefined) {
            updates.push(`"telegramToken" = $${paramIndex++}`);
            values.push(dto.telegramToken);
        }

        if (updates.length === 0) {
            return this.getAgentById(id);
        }

        updates.push(`updated_at = $${paramIndex++}`);
        values.push(new Date());
        values.push(id);

        await query(
            `UPDATE agents SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
            values
        );

        return this.getAgentById(id);
    }

    async deleteAgent(id: string): Promise<boolean> {
        // First, stop and remove container if exists
        await dockerService.removeAgentContainer(id);

        // Clean up Chroma collection via gateway
        try {
            const gatewayUrl = process.env.GATEWAY_URL || 'http://leo-gateway:8080';
            await fetch(`${gatewayUrl}/api/v1/documents/${id}/collection`, {
                method: 'DELETE',
            });
        } catch (error) {
            console.warn('Failed to delete Chroma collection:', error);
            // Continue with deletion anyway
        }

        // Delete related data (CASCADE should handle most, but be explicit)
        await query(`DELETE FROM system_prompt_versions WHERE agent_id = $1`, [id]);
        await query(`DELETE FROM agent_messages WHERE agent_id = $1`, [id]);
        await query(`DELETE FROM agent_summaries WHERE agent_id = $1`, [id]);
        await query(`DELETE FROM knowledge_bases WHERE "agentId" = $1`, [id]);

        // Delete the agent
        await query(`DELETE FROM agents WHERE id = $1`, [id]);
        return true;
    }

    async startAgent(id: string): Promise<Agent | null> {
        const agent = await this.getAgentById(id);

        if (!agent) {
            return null;
        }

        // Fetch behavior settings
        const behavior = await behaviorService.getBehaviorForContainer(id);

        // Update status to STARTING
        await this.updateAgentStatus(id, 'STARTING');

        try {
            const containerInfo = await dockerService.startAgentContainer({
                agentId: agent.id,
                userId: agent.userId,
                agentName: agent.name,
                systemPrompt: agent.systemPrompt,
                telegramToken: agent.telegramToken || '', // Pass empty string if no token
                behavior: behavior || undefined,
            });

            // Update agent with container info
            await query(
                `UPDATE agents SET status = 'RUNNING', "containerId" = $1, "containerName" = $2, updated_at = $3 WHERE id = $4`,
                [containerInfo.containerId, containerInfo.containerName, new Date(), id]
            );

            return this.getAgentById(id);
        } catch (error) {
            await this.updateAgentStatus(id, 'ERROR');
            throw error;
        }
    }

    async stopAgent(id: string): Promise<Agent | null> {
        const agent = await this.getAgentById(id);

        if (!agent) {
            return null;
        }

        await dockerService.stopAgentContainer(id);
        await this.updateAgentStatus(id, 'STOPPED');

        return this.getAgentById(id);
    }

    async getAgentStatus(id: string): Promise<{ agent: Agent; container: ContainerInfo | null } | null> {
        const agent = await this.getAgentById(id);

        if (!agent) {
            return null;
        }

        const containerInfo = await dockerService.getContainerStatus(id);

        // Sync status if container state differs from DB
        if (containerInfo) {
            const containerStatus = containerInfo.status;
            let dbStatus: AgentStatus = 'STOPPED';

            if (containerStatus === 'running') {
                dbStatus = 'RUNNING';
            } else if (containerStatus === 'error') {
                dbStatus = 'ERROR';
            }

            if (agent.status !== dbStatus) {
                await this.updateAgentStatus(id, dbStatus);
                agent.status = dbStatus;
            }
        } else if (agent.status === 'RUNNING') {
            // Container doesn't exist but DB says running - sync
            await this.updateAgentStatus(id, 'STOPPED');
            agent.status = 'STOPPED';
        }

        return { agent, container: containerInfo };
    }

    async getAgentStats(id: string): Promise<{
        totalDialogs: number;
        todayDialogs: number;
        totalTokens: number;
        avgResponseTimeMs: number;
    }> {
        const stats = await queryOne<{
            total_dialogs: string;
            today_dialogs: string;
            total_tokens: string;
            avg_response_time: string;
        }>(
            `WITH token_stats AS (
                SELECT 
                    COALESCE(SUM(total_tokens), 0) as total_tokens,
                    COALESCE(AVG(response_time_ms) FILTER (WHERE response_time_ms > 0), 0) as avg_response_time
                FROM token_usage 
                WHERE agent_id = $1 AND (is_test IS NULL OR is_test = false)
            ),
            dialog_stats AS (
                SELECT COUNT(DISTINCT telegram_user_id) as total_dialogs
                FROM agent_messages
                WHERE agent_id = $1 AND (is_test IS NULL OR is_test = false)
            ),
            today_dialogs AS (
                SELECT COUNT(DISTINCT telegram_user_id) as today_dialogs
                FROM agent_messages
                WHERE agent_id = $1 AND created_at >= CURRENT_DATE AND (is_test IS NULL OR is_test = false)
            )
            SELECT 
                d.total_dialogs,
                td.today_dialogs,
                ts.total_tokens,
                ts.avg_response_time
            FROM token_stats ts, dialog_stats d, today_dialogs td`,
            [id]
        );

        return {
            totalDialogs: parseInt(stats?.total_dialogs || '0', 10),
            todayDialogs: parseInt(stats?.today_dialogs || '0', 10),
            totalTokens: parseInt(stats?.total_tokens || '0', 10),
            avgResponseTimeMs: Math.round(parseFloat(stats?.avg_response_time || '0')),
        };
    }

    async getAgentStatsByPeriod(id: string, from: Date, to: Date): Promise<Array<{
        date: string;
        tokens: number;
        dialogs: number;
    }>> {
        const stats = await query<{
            day: Date;
            tokens: string;
            dialogs: string;
        }>(
            `WITH dates AS (
                SELECT generate_series($2::date, $3::date, '1 day'::interval)::date as day
            ),
            daily_tokens AS (
                SELECT 
                    created_at::date as day,
                    SUM(total_tokens) as tokens
                FROM token_usage
                WHERE agent_id = $1 AND created_at >= $2 AND created_at <= $3 + interval '1 day' AND (is_test IS NULL OR is_test = false)
                GROUP BY 1
            ),
            daily_dialogs AS (
                SELECT
                    created_at::date as day,
                    COUNT(DISTINCT telegram_user_id) as dialogs
                FROM agent_messages
                WHERE agent_id = $1 AND created_at >= $2 AND created_at <= $3 + interval '1 day' AND (is_test IS NULL OR is_test = false)
                GROUP BY 1
            )
            SELECT 
                d.day,
                COALESCE(dt.tokens, 0) as tokens,
                COALESCE(dd.dialogs, 0) as dialogs
            FROM dates d
            LEFT JOIN daily_tokens dt ON dt.day = d.day
            LEFT JOIN daily_dialogs dd ON dd.day = d.day
            ORDER BY d.day ASC`,
            [id, from, to]
        );

        return stats.map(s => ({
            date: s.day.toISOString().split('T')[0],
            tokens: parseInt(s.tokens || '0', 10),
            dialogs: parseInt(s.dialogs || '0', 10),
        }));
    }

    async getUserStats(userId: string): Promise<{
        totalDialogs: number;
        totalMessages: number;
        totalUsers: number;
        totalTokens: number;
    }> {
        // Get user's agents first
        const agents = await this.getAgentsByUser(userId);
        const agentIds = agents.map(a => a.id);

        if (agentIds.length === 0) {
            return {
                totalDialogs: 0,
                totalMessages: 0,
                totalUsers: 0,
                totalTokens: 0,
            };
        }

        const result = await queryOne<{
            total_dialogs: string;
            total_messages: string;
            total_users: string;
            total_tokens: string;
        }>(
            `SELECT
                (SELECT COUNT(DISTINCT (agent_id, telegram_user_id)) FROM agent_messages WHERE agent_id = ANY($1) AND (is_test IS NULL OR is_test = false)) as total_dialogs,
                (SELECT COUNT(*) FROM agent_messages WHERE agent_id = ANY($1) AND (is_test IS NULL OR is_test = false)) as total_messages,
                (SELECT COUNT(DISTINCT telegram_user_id) FROM agent_messages WHERE agent_id = ANY($1) AND (is_test IS NULL OR is_test = false)) as total_users,
                (SELECT COALESCE(SUM(total_tokens), 0) FROM token_usage WHERE "userId" = $2 AND (is_test IS NULL OR is_test = false)) as total_tokens`,
            [agentIds, userId]
        );

        return {
            totalDialogs: parseInt(result?.total_dialogs || '0', 10),
            totalMessages: parseInt(result?.total_messages || '0', 10),
            totalUsers: parseInt(result?.total_users || '0', 10),
            totalTokens: parseInt(result?.total_tokens || '0', 10),
        };
    }

    async getUserStatsHistory(userId: string): Promise<{
        last24h: Array<{ date: string; tokens: number; dialogs: number }>;
        last7d: Array<{ date: string; tokens: number; dialogs: number }>;
        last30d: Array<{ date: string; tokens: number; dialogs: number }>;
    }> {
        const agents = await this.getAgentsByUser(userId);
        const agentIds = agents.map(a => a.id);

        if (agentIds.length === 0) {
            return { last24h: [], last7d: [], last30d: [] };
        }

        // 24 Hours (Hourly interval)
        const stats24h = await query<{ date: Date; tokens: string; dialogs: string }>(
            `WITH points AS (
                SELECT generate_series(date_trunc('hour', NOW() - INTERVAL '24 hours'), date_trunc('hour', NOW()), '1 hour'::interval) as date
            ),
            data AS (
                SELECT 
                    date_trunc('hour', created_at) as date,
                    SUM(total_tokens) as tokens
                FROM token_usage
                WHERE "userId" = $2 AND created_at >= NOW() - INTERVAL '24 hours' AND (is_test IS NULL OR is_test = false)
                GROUP BY 1
            ),
            dialogs AS (
                SELECT
                    date_trunc('hour', created_at) as date,
                    COUNT(DISTINCT telegram_user_id) FILTER (WHERE agent_id IS NOT NULL) as count
                FROM agent_messages
                WHERE agent_id = ANY($1) AND created_at >= NOW() - INTERVAL '24 hours' AND (is_test IS NULL OR is_test = false)
                GROUP BY 1
            )
            SELECT 
                p.date,
                COALESCE(d.tokens, 0) as tokens,
                COALESCE(dg.count, 0) as dialogs
            FROM points p
            LEFT JOIN data d ON d.date = p.date
            LEFT JOIN dialogs dg ON dg.date = p.date
            ORDER BY p.date ASC`,
            [agentIds, userId]
        );

        // 7 Days (Daily interval)
        const stats7d = await query<{ date: Date; tokens: string; dialogs: string }>(
            `WITH points AS (
                SELECT generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day'::interval)::date as date
            ),
            data AS (
                SELECT 
                    created_at::date as date,
                    SUM(total_tokens) as tokens
                FROM token_usage
                WHERE "userId" = $2 AND created_at >= CURRENT_DATE - INTERVAL '6 days' AND (is_test IS NULL OR is_test = false)
                GROUP BY 1
            ),
            dialogs AS (
                SELECT
                    created_at::date as date,
                    COUNT(DISTINCT telegram_user_id) FILTER (WHERE agent_id IS NOT NULL) as count
                FROM agent_messages
                WHERE agent_id = ANY($1) AND created_at >= CURRENT_DATE - INTERVAL '6 days' AND (is_test IS NULL OR is_test = false)
                GROUP BY 1
            )
            SELECT 
                p.date,
                COALESCE(d.tokens, 0) as tokens,
                COALESCE(dg.count, 0) as dialogs
            FROM points p
            LEFT JOIN data d ON d.date = p.date
            LEFT JOIN dialogs dg ON dg.date = p.date
            ORDER BY p.date ASC`,
            [agentIds, userId]
        );

        // 30 Days (3 Days interval)
        // Note: generate_series supports step. For grouping data, we can truncate or bin.
        // Simplest strategy: Generate series with 3 day step, join with data grouped by 3-day buckets relative to start.
        // Or easier: generate series, join daily data, then group by bucket in application? No, let's do SQL.
        // We group by floor((current_date - date) / 3).
        const stats30d = await query<{ date: Date; tokens: string; dialogs: string }>(
            `WITH periods AS (
                SELECT generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '3 days'::interval)::date as start_date
            ),
            data_raw AS (
                 SELECT created_at::date as day, total_tokens FROM token_usage WHERE "userId" = $2 AND created_at >= CURRENT_DATE - INTERVAL '30 days' AND (is_test IS NULL OR is_test = false)
            ),
            dialogs_raw AS (
                 SELECT created_at::date as day, agent_id, telegram_user_id FROM agent_messages WHERE agent_id = ANY($1) AND created_at >= CURRENT_DATE - INTERVAL '30 days' AND (is_test IS NULL OR is_test = false)
            )
            SELECT 
                p.start_date as date,
                COALESCE(SUM(d.total_tokens), 0) as tokens,
                COUNT(DISTINCT dg.telegram_user_id) FILTER (WHERE dg.agent_id IS NOT NULL) as dialogs
            FROM periods p
            LEFT JOIN data_raw d ON d.day >= p.start_date AND d.day < p.start_date + INTERVAL '3 days'
            LEFT JOIN dialogs_raw dg ON dg.day >= p.start_date AND dg.day < p.start_date + INTERVAL '3 days'
            GROUP BY p.start_date
            ORDER BY p.start_date ASC`,
            [agentIds, userId]
        );

        return {
            last24h: stats24h.map(s => ({
                date: s.date.toISOString(),
                tokens: parseInt(s.tokens || '0', 10),
                dialogs: parseInt(s.dialogs || '0', 10)
            })),
            last7d: stats7d.map(s => ({
                date: s.date.toISOString().split('T')[0],
                tokens: parseInt(s.tokens || '0', 10),
                dialogs: parseInt(s.dialogs || '0', 10)
            })),
            last30d: stats30d.map(s => ({
                date: s.date.toISOString().split('T')[0],
                tokens: parseInt(s.tokens || '0', 10),
                dialogs: parseInt(s.dialogs || '0', 10)
            })),
        };
    }

    private async updateAgentStatus(id: string, status: AgentStatus): Promise<void> {
        await query(
            `UPDATE agents SET status = $1, updated_at = $2 WHERE id = $3`,
            [status, new Date(), id]
        );
    }
}

export const agentsService = new AgentsService();
