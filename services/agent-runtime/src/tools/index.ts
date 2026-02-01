import { reportConflictTool, executeReportConflict } from './report-conflict';
import type { ReportConflictParams, ConflictingFile } from './report-conflict';

export { reportConflictTool, executeReportConflict };
export type { ReportConflictParams, ConflictingFile };

// All available tools for the agent
export const agentTools = [
    // Add tools here as they are created
    reportConflictTool,
];
