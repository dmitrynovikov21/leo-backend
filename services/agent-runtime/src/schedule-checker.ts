/**
 * Schedule Checker Service
 * Checks if the bot should respond based on working hours and holidays
 */

import { queryOne } from './db';
import { config } from './config';

export interface ScheduleInfo {
    isWorking: boolean;
    offlineMessage: string | null;
}

interface AgentSchedule {
    work_schedule: boolean[][] | null;  // 7 days × 24 hours
    holidays: string[] | null;           // ["08.01.2026"]
    offline_message: string | null;
}

class ScheduleChecker {
    /**
     * Get schedule from database (no caching - always fresh)
     */
    private async getSchedule(): Promise<AgentSchedule | null> {
        const result = await queryOne<AgentSchedule>(
            `SELECT work_schedule, holidays, offline_message FROM agents WHERE id = $1`,
            [config.agentId]
        );

        return result;
    }

    /**
     * Check if current time is within working hours
     * @returns ScheduleInfo with isWorking flag and offline message
     */
    async checkSchedule(): Promise<ScheduleInfo> {
        const schedule = await this.getSchedule();

        // No schedule configured = always working
        if (!schedule || !schedule.work_schedule) {
            return { isWorking: true, offlineMessage: null };
        }

        const now = new Date();

        // Check holidays first (format: "DD.MM.YYYY")
        if (schedule.holidays && schedule.holidays.length > 0) {
            const todayStr = now.toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            }).replace(/\//g, '.');

            if (schedule.holidays.includes(todayStr)) {
                console.log(`📅 Today (${todayStr}) is a holiday`);
                return {
                    isWorking: false,
                    offlineMessage: schedule.offline_message || 'Сегодня выходной день.'
                };
            }
        }

        // Check weekly schedule
        // JavaScript: 0=Sunday, 1=Monday, ..., 6=Saturday
        // Our format: 0=Monday, 1=Tuesday, ..., 6=Sunday
        const jsDay = now.getDay(); // 0-6, Sunday=0
        const ourDay = jsDay === 0 ? 6 : jsDay - 1; // Convert to our format
        const hour = now.getHours(); // 0-23

        const daySchedule = schedule.work_schedule[ourDay];

        if (!daySchedule || daySchedule.length !== 24) {
            // Invalid schedule = treat as working
            return { isWorking: true, offlineMessage: null };
        }

        const isWorking = daySchedule[hour] === true;

        if (!isWorking) {
            console.log(`⏰ Outside working hours (day=${ourDay}, hour=${hour})`);
            return {
                isWorking: false,
                offlineMessage: schedule.offline_message || 'Сейчас нерабочее время.'
            };
        }

        return { isWorking: true, offlineMessage: null };
    }

    /**
     * Get human-readable schedule description for system prompt
     */
    async getScheduleDescription(): Promise<string | null> {
        const schedule = await this.getSchedule();

        if (!schedule || !schedule.work_schedule) {
            return null;
        }

        const dayNames = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
        const dayNamesShort = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

        const lines: string[] = [];

        for (let day = 0; day < 7; day++) {
            const daySchedule = schedule.work_schedule[day];
            if (!daySchedule) continue;

            // Find working hours ranges
            const ranges: string[] = [];
            let start: number | null = null;

            for (let hour = 0; hour <= 24; hour++) {
                const isWorking = hour < 24 && daySchedule[hour] === true;

                if (isWorking && start === null) {
                    start = hour;
                } else if (!isWorking && start !== null) {
                    ranges.push(`${start.toString().padStart(2, '0')}:00-${hour.toString().padStart(2, '0')}:00`);
                    start = null;
                }
            }

            if (ranges.length === 0) {
                lines.push(`${dayNamesShort[day]}: выходной`);
            } else {
                lines.push(`${dayNamesShort[day]}: ${ranges.join(', ')}`);
            }
        }

        let result = '## ГРАФИК РАБОТЫ\n' + lines.join('\n');

        // Add holidays if any
        if (schedule.holidays && schedule.holidays.length > 0) {
            result += `\n\nВыходные дни: ${schedule.holidays.join(', ')}`;
        }

        return result;
    }
}

export const scheduleChecker = new ScheduleChecker();
