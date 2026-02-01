import axios from 'axios';
import { config } from '../config';

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
                                description: "The UUID of the source file (File ID) or note (Note ID) found in the context. If not available, use the section name."
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

/**
 * Execute the report_conflict tool - sends conflict data to Gateway API
 */
export async function executeReportConflict(
    params: ReportConflictParams,
    chatId?: string
): Promise<string> {
    try {
        console.log(`⚠️ Conflict detected: ${params.topic}`);
        console.log(`   Files: ${params.conflicting_files.map(f => f.file_name).join(' vs ')}`);

        await axios.post(`${config.gatewayUrl}/api/v1/conflicts`, {
            agentId: config.agentId,
            chatId: chatId || null,
            topic: params.topic,
            conflictingFiles: params.conflicting_files,
        });

        return `Conflict reported successfully: ${params.topic}`;
    } catch (error: any) {
        console.error('Failed to report conflict:', error.message);
        return `Failed to report conflict: ${error.message}`;
    }
}
