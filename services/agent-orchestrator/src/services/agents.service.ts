import { query, queryOne } from '../db';
import { dockerService, ContainerInfo } from './docker.service';

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

        const result = await query(`DELETE FROM agents WHERE id = $1`, [id]);
        return true;
    }

    async startAgent(id: string): Promise<Agent | null> {
        const agent = await this.getAgentById(id);

        if (!agent) {
            return null;
        }



        // Update status to STARTING
        await this.updateAgentStatus(id, 'STARTING');

        try {
            const containerInfo = await dockerService.startAgentContainer({
                agentId: agent.id,
                userId: agent.userId,
                agentName: agent.name,
                systemPrompt: agent.systemPrompt,
                telegramToken: agent.telegramToken || '', // Pass empty string if no token
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

    private async updateAgentStatus(id: string, status: AgentStatus): Promise<void> {
        await query(
            `UPDATE agents SET status = $1, updated_at = $2 WHERE id = $3`,
            [status, new Date(), id]
        );
    }
}

export const agentsService = new AgentsService();
