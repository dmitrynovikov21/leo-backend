import { query, queryOne } from '../db';

export interface AgentBehavior {
    agentId: string;
    displayName: string | null;
    avatarEmoji: string | null;
    temperature: number;
    debounceMs: number;
    welcomeMessage: string | null;
    tone: string[];
    guardrails: { id: string; rule: string }[];
}

export interface PromptVersion {
    id: string;
    agentId: string;
    version: string;
    content: string;
    isActive: boolean;
    createdAt: Date;
}

export interface UpdateBehaviorDto {
    displayName?: string;
    avatarEmoji?: string;
    temperature?: number;
    debounceMs?: number;
    welcomeMessage?: string;
    tone?: string[];
    guardrails?: { rule: string }[];
}

export interface CreatePromptDto {
    version: string;
    content: string;
}

function generateCuid(): string {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 10);
    return `c${timestamp}${randomPart}`;
}

class BehaviorService {
    /**
     * Get behavior settings from agents table
     */
    async getBehavior(agentId: string): Promise<AgentBehavior | null> {
        const agent = await queryOne<any>(
            `SELECT id, display_name, avatar_emoji, temperature, debounce_ms, welcome_message, tone, guardrails
             FROM agents WHERE id = $1`,
            [agentId]
        );

        if (!agent) return null;

        return {
            agentId: agent.id,
            displayName: agent.display_name,
            avatarEmoji: agent.avatar_emoji,
            temperature: agent.temperature != null ? parseFloat(agent.temperature) : 0.5,
            debounceMs: agent.debounce_ms != null ? parseInt(agent.debounce_ms, 10) : 5000,
            welcomeMessage: agent.welcome_message,
            tone: agent.tone || [],
            guardrails: agent.guardrails || [],
        };
    }

    /**
     * Update behavior settings in agents table
     */
    async updateBehavior(agentId: string, dto: UpdateBehaviorDto): Promise<AgentBehavior | null> {
        // Check agent exists
        const agent = await queryOne<{ id: string }>(`SELECT id FROM agents WHERE id = $1`, [agentId]);
        if (!agent) return null;

        // Add IDs to guardrails if provided
        let guardrailsWithIds = dto.guardrails;
        if (dto.guardrails) {
            guardrailsWithIds = dto.guardrails.map((g) => ({
                id: generateCuid(),
                rule: g.rule,
            }));
        }

        const updates: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        if (dto.displayName !== undefined) {
            updates.push(`display_name = $${paramIndex++}`);
            values.push(dto.displayName);
        }
        if (dto.avatarEmoji !== undefined) {
            updates.push(`avatar_emoji = $${paramIndex++}`);
            values.push(dto.avatarEmoji);
        }
        if (dto.temperature !== undefined) {
            updates.push(`temperature = $${paramIndex++}`);
            values.push(dto.temperature);
        }
        if (dto.debounceMs !== undefined) {
            updates.push(`debounce_ms = $${paramIndex++}`);
            values.push(dto.debounceMs);
        }
        if (dto.welcomeMessage !== undefined) {
            updates.push(`welcome_message = $${paramIndex++}`);
            values.push(dto.welcomeMessage);
        }
        if (dto.tone !== undefined) {
            updates.push(`tone = $${paramIndex++}`);
            values.push(dto.tone);
        }
        if (guardrailsWithIds !== undefined) {
            updates.push(`guardrails = $${paramIndex++}`);
            values.push(JSON.stringify(guardrailsWithIds));
        }

        if (updates.length > 0) {
            updates.push(`updated_at = $${paramIndex++}`);
            values.push(new Date());
            values.push(agentId);

            await query(
                `UPDATE agents SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
                values
            );
        }

        return this.getBehavior(agentId);
    }

    /**
     * Get all prompt versions for an agent
     */
    async getPromptVersions(agentId: string): Promise<{ versions: PromptVersion[]; activePrompt: PromptVersion | null } | null> {
        // Check agent exists
        const agent = await queryOne<{ id: string }>(`SELECT id FROM agents WHERE id = $1`, [agentId]);
        if (!agent) return null;

        const versions = await query<any>(
            `SELECT id, agent_id, version, content, is_active, created_at
             FROM system_prompt_versions
             WHERE agent_id = $1
             ORDER BY created_at DESC`,
            [agentId]
        );

        const mapped: PromptVersion[] = versions.map((v) => ({
            id: v.id,
            agentId: v.agent_id,
            version: v.version,
            content: v.content,
            isActive: v.is_active,
            createdAt: v.created_at,
        }));

        const activePrompt = mapped.find((v) => v.isActive) || null;

        return { versions: mapped, activePrompt };
    }

    /**
     * Create a new prompt version (auto-activates)
     */
    async createPromptVersion(agentId: string, dto: CreatePromptDto): Promise<PromptVersion | null> {
        // Check agent exists
        const agent = await queryOne<{ id: string }>(`SELECT id FROM agents WHERE id = $1`, [agentId]);
        if (!agent) return null;

        const id = generateCuid();
        const now = new Date();

        // Insert new version as active (trigger will deactivate others)
        await query(
            `INSERT INTO system_prompt_versions (id, agent_id, version, content, is_active, created_at)
             VALUES ($1, $2, $3, $4, true, $5)`,
            [id, agentId, dto.version, dto.content, now]
        );

        // Also update the agent's systemPrompt to match
        await query(
            `UPDATE agents SET "systemPrompt" = $1, updated_at = $2 WHERE id = $3`,
            [dto.content, now, agentId]
        );

        return {
            id,
            agentId,
            version: dto.version,
            content: dto.content,
            isActive: true,
            createdAt: now,
        };
    }

    /**
     * Activate a specific prompt version
     */
    async activatePromptVersion(agentId: string, versionId: string): Promise<PromptVersion | null> {
        // Check version exists and belongs to agent
        const version = await queryOne<any>(
            `SELECT id, agent_id, version, content, is_active, created_at
             FROM system_prompt_versions
             WHERE id = $1 AND agent_id = $2`,
            [versionId, agentId]
        );

        if (!version) return null;

        const now = new Date();

        // Activate this version (trigger will deactivate others)
        await query(
            `UPDATE system_prompt_versions SET is_active = true WHERE id = $1`,
            [versionId]
        );

        // Update agent's systemPrompt
        await query(
            `UPDATE agents SET "systemPrompt" = $1, updated_at = $2 WHERE id = $3`,
            [version.content, now, agentId]
        );

        return {
            id: version.id,
            agentId: version.agent_id,
            version: version.version,
            content: version.content,
            isActive: true,
            createdAt: version.created_at,
        };
    }

    /**
     * Update an existing prompt version
     */
    async updatePromptVersion(agentId: string, versionId: string, dto: { version?: string; content?: string }): Promise<PromptVersion | null> {
        // Check version exists and belongs to agent
        const version = await queryOne<any>(
            `SELECT id, agent_id, version, content, is_active, created_at
             FROM system_prompt_versions
             WHERE id = $1 AND agent_id = $2`,
            [versionId, agentId]
        );

        if (!version) return null;

        const updates: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        if (dto.version !== undefined) {
            updates.push(`version = $${paramIndex++}`);
            values.push(dto.version);
        }
        if (dto.content !== undefined) {
            updates.push(`content = $${paramIndex++}`);
            values.push(dto.content);
        }

        if (updates.length > 0) {
            values.push(versionId);
            await query(
                `UPDATE system_prompt_versions SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
                values
            );

            // If this version is active, also update agent's systemPrompt
            if (version.is_active && dto.content !== undefined) {
                await query(
                    `UPDATE agents SET "systemPrompt" = $1, updated_at = $2 WHERE id = $3`,
                    [dto.content, new Date(), agentId]
                );
            }
        }

        // Get updated version
        const updated = await queryOne<any>(
            `SELECT id, agent_id, version, content, is_active, created_at
             FROM system_prompt_versions WHERE id = $1`,
            [versionId]
        );

        return {
            id: updated.id,
            agentId: updated.agent_id,
            version: updated.version,
            content: updated.content,
            isActive: updated.is_active,
            createdAt: updated.created_at,
        };
    }

    /**
     * Get full behavior config for container startup
     */
    async getBehaviorForContainer(agentId: string): Promise<{
        displayName: string | null;
        avatarEmoji: string | null;
        temperature: number;
        debounceMs: number;
        welcomeMessage: string | null;
        tone: string[];
        guardrails: { id: string; rule: string }[];
    } | null> {
        const behavior = await this.getBehavior(agentId);
        if (!behavior) return null;

        return {
            displayName: behavior.displayName,
            avatarEmoji: behavior.avatarEmoji,
            temperature: behavior.temperature,
            debounceMs: behavior.debounceMs,
            welcomeMessage: behavior.welcomeMessage,
            tone: behavior.tone,
            guardrails: behavior.guardrails,
        };
    }
}

export const behaviorService = new BehaviorService();
