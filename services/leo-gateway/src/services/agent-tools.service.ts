import { pool } from '../db';

export interface ConflictingFile {
    file_id: string;
    file_name: string;
    value_found: string;
}

export interface ReportConflictParams {
    topic: string;
    conflicting_files: ConflictingFile[];
}

// OpenAI-compatible tool definition
export const reportConflictTool = {
    type: "function" as const,
    function: {
        name: "report_conflict",
        description: "Report conflicting or contradictory information found in knowledge base documents. Use this when you detect that different documents contain different values for the same fact (e.g., different prices, dates, or specifications).",
        parameters: {
            type: "object",
            properties: {
                topic: {
                    type: "string",
                    description: "Subject of the conflict (e.g., 'Цена услуги', 'Адрес офиса', 'Дата мероприятия')"
                },
                conflicting_files: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            file_id: {
                                type: "string",
                                description: "ID or name of the source file/document"
                            },
                            file_name: {
                                type: "string",
                                description: "Human-readable name of the document"
                            },
                            value_found: {
                                type: "string",
                                description: "The conflicting value found in this document"
                            }
                        },
                        required: ["file_id", "file_name", "value_found"]
                    },
                    description: "Array of files with conflicting values (minimum 2)"
                }
            },
            required: ["topic", "conflicting_files"]
        }
    }
};

function generateId(): string {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 10);
    return `c${timestamp}${randomPart}`;
}

export async function executeReportConflict(
    agentId: string,
    params: ReportConflictParams,
    chatId?: string
): Promise<string> {
    try {
        console.log(`⚠️ Conflict detected (Gateway): ${params.topic}`);
        console.log(`   Files: ${params.conflicting_files.map(f => f.file_name).join(' vs ')}`);

        // Get user_id for this agent (required by Prisma schema)
        const agentResult = await pool.query(
            `SELECT "userId" FROM agents WHERE id = $1`,
            [agentId]
        );

        if (agentResult.rows.length === 0) {
            throw new Error(`Agent ${agentId} not found`);
        }

        const userId = agentResult.rows[0].userId;
        const id = generateId();

        // Insert with UPPER CASE status 'NEW' required by Prisma Enum
        await pool.query(
            `INSERT INTO knowledge_conflicts (id, "user_id", "agent_id", "chat_id", topic, details, status, "detected_at")
             VALUES ($1, $2, $3, $4, $5, $6, 'NEW', NOW())`,
            [id, userId, agentId, chatId || null, params.topic, JSON.stringify(params.conflicting_files)]
        );

        return `Conflict reported successfully: ${params.topic}`;
    } catch (error: any) {
        console.error('Failed to report conflict in Gateway:', error.message);
        return `Failed to report conflict: ${error.message}`;
    }
}

export const agentTools = [
    reportConflictTool,
];
