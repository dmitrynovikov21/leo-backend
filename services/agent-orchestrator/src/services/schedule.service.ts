import { query, queryOne } from '../db';

export interface AgentSchedule {
    schedule: boolean[][] | null;  // 7 days × 24 hours
    holidays: string[];            // ["04.09.2025", "11.09.2025"]
    message: string | null;        // Offline message
}

export interface UpdateScheduleDto {
    schedule?: boolean[][];
    holidays?: string[];
    message?: string;
}

class ScheduleService {
    /**
     * Get schedule settings for an agent
     */
    async getSchedule(agentId: string): Promise<AgentSchedule | null> {
        const agent = await queryOne<any>(
            `SELECT id, work_schedule, holidays, offline_message
             FROM agents WHERE id = $1`,
            [agentId]
        );

        if (!agent) return null;

        return {
            schedule: agent.work_schedule || null,
            holidays: agent.holidays || [],
            message: agent.offline_message || null,
        };
    }

    /**
     * Update schedule settings for an agent
     */
    async updateSchedule(agentId: string, dto: UpdateScheduleDto): Promise<AgentSchedule | null> {
        // Check agent exists
        const agent = await queryOne<{ id: string }>(`SELECT id FROM agents WHERE id = $1`, [agentId]);
        if (!agent) return null;

        const updates: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        if (dto.schedule !== undefined) {
            updates.push(`work_schedule = $${paramIndex++}`);
            values.push(JSON.stringify(dto.schedule));
        }
        if (dto.holidays !== undefined) {
            updates.push(`holidays = $${paramIndex++}`);
            values.push(dto.holidays);
        }
        if (dto.message !== undefined) {
            updates.push(`offline_message = $${paramIndex++}`);
            values.push(dto.message);
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

        return this.getSchedule(agentId);
    }
}

export const scheduleService = new ScheduleService();
