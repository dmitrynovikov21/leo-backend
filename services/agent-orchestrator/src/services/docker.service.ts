import Docker from 'dockerode';
import { config } from '../config';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

export interface AgentBehaviorConfig {
    displayName?: string | null;
    avatarEmoji?: string | null;
    temperature?: number;
    debounceMs?: number;
    welcomeMessage?: string | null;
    tone?: string[];
    guardrails?: { id: string; rule: string }[];
}

export interface AgentContainerConfig {
    agentId: string;
    userId: string;
    agentName: string;
    systemPrompt: string;
    telegramToken: string;
    behavior?: AgentBehaviorConfig;
}

export interface ContainerInfo {
    containerId: string;
    containerName: string;
    status: string;
}

class DockerService {
    // Finds a container by label, which is more robust than naming conventions
    private async findContainerByAgentId(agentId: string): Promise<Docker.Container | null> {
        const containers = await docker.listContainers({
            all: true, // Include stopped containers
            filters: {
                label: [`leo.agent.id=${agentId}`]
            }
        });

        if (containers.length > 0) {
            return docker.getContainer(containers[0].Id);
        }
        return null;
    }

    async startAgentContainer(agentConfig: AgentContainerConfig): Promise<ContainerInfo> {
        const containerName = `leo-agent-${agentConfig.agentId}`;

        // Check if container already exists and remove it to ensure fresh start with latest image/env
        try {
            const existingContainer = docker.getContainer(containerName);
            await existingContainer.inspect(); // Check if exists

            // If we are here, container exists. Remove it.
            // This ensures we always pick up the latest 'latest' image and new env vars.
            await existingContainer.remove({ force: true });
        } catch (error: any) {
            // Container doesn't exist, ignore 404
            if (error.statusCode !== 404) {
                throw error;
            }
        }

        // Build identity instruction from behavior
        const behavior = agentConfig.behavior || {};
        const identityInstruction = behavior.displayName
            ? `Ты — ${behavior.displayName}.`
            : '';

        // Build environment variables
        const envVars = [
            `AGENT_ID=${agentConfig.agentId}`,
            `USER_ID=${agentConfig.userId}`,
            `AGENT_NAME=${agentConfig.agentName}`,
            `SYSTEM_PROMPT=${agentConfig.systemPrompt}`,
            `TELEGRAM_BOT_TOKEN=${agentConfig.telegramToken}`,
            `GATEWAY_URL=${config.gatewayUrl}`,
            `DATABASE_URL=${config.databaseUrl}`,
            // Behavior settings
            `DISPLAY_NAME=${behavior.displayName || ''}`,
            `AVATAR_EMOJI=${behavior.avatarEmoji || ''}`,
            `TEMPERATURE=${behavior.temperature ?? 0.7}`,
            `DEBOUNCE_MS=${behavior.debounceMs ?? 5000}`,
            `WELCOME_MESSAGE=${behavior.welcomeMessage || ''}`,
            `TONE=${JSON.stringify(behavior.tone || [])}`,
            `GUARDRAILS=${JSON.stringify(behavior.guardrails || [])}`,
            `IDENTITY_INSTRUCTION=${identityInstruction}`,
        ];

        // Add LangSmith if configured
        if (process.env.LANGCHAIN_TRACING_V2) {
            envVars.push(`LANGCHAIN_TRACING_V2=${process.env.LANGCHAIN_TRACING_V2}`);
        }
        if (process.env.LANGCHAIN_API_KEY) {
            envVars.push(`LANGCHAIN_API_KEY=${process.env.LANGCHAIN_API_KEY}`);
        }
        if (process.env.LANGCHAIN_PROJECT) {
            envVars.push(`LANGCHAIN_PROJECT=${process.env.LANGCHAIN_PROJECT}`);
        }

        // Create new container
        const container = await docker.createContainer({
            Image: config.agentImage,
            name: containerName,
            Env: envVars,
            HostConfig: {
                NetworkMode: config.dockerNetwork,
                RestartPolicy: {
                    Name: 'unless-stopped',
                },
            },
            Labels: {
                'leo.agent.id': agentConfig.agentId,
                'leo.user.id': agentConfig.userId,
                'leo.managed': 'true',
            },
        });

        await container.start();
        const info = await container.inspect();

        return {
            containerId: info.Id,
            containerName: info.Name.replace('/', ''),
            status: 'running',
        };
    }

    async stopAgentContainer(agentId: string): Promise<void> {
        const container = await this.findContainerByAgentId(agentId);
        if (!container) return;

        try {
            await container.stop();
        } catch (error: any) {
            if (error.statusCode === 304) return; // Already stopped
            if (error.statusCode === 404) return;
            throw error;
        }
    }

    async removeAgentContainer(agentId: string): Promise<void> {
        const container = await this.findContainerByAgentId(agentId);
        if (!container) return;

        try {
            await container.stop().catch(() => { }); // Ignore stop errors
            await container.remove({ force: true });
        } catch (error: any) {
            if (error.statusCode === 404) return;
            throw error;
        }
    }

    async getContainerStatus(agentId: string): Promise<ContainerInfo | null> {
        const container = await this.findContainerByAgentId(agentId);
        if (!container) return null;

        try {
            const info = await container.inspect();

            let status = info.State.Status;
            // 'created', 'restarting', 'running', 'removing', 'paused', 'exited', 'dead'

            return {
                containerId: info.Id,
                containerName: info.Name.replace('/', ''),
                status,
            };
        } catch (error: any) {
            if (error.statusCode === 404) return null;
            throw error;
        }
    }

    async getContainerLogs(agentId: string, tail: number = 100): Promise<string> {
        const container = await this.findContainerByAgentId(agentId);
        if (!container) return '';

        try {
            const logs = await container.logs({
                stdout: true,
                stderr: true,
                tail,
                timestamps: true,
            });

            return logs.toString('utf-8');
        } catch (error: any) {
            if (error.statusCode === 404) return '';
            throw error;
        }
    }
}

export const dockerService = new DockerService();
