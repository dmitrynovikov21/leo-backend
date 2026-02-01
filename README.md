# LEO AI Platform - Project Documentation

This documentation is designed to provide context for AI agents and developers working on the Leo AI Platform.

## Project Overview

The Leo AI Platform is a comprehensive system for managing and deploying AI agents. It orchestrates LLM interactions, manages vector memory (RAG), and handles agent lifecycles.

### Architecture

The system is composed of several Dockerized services defined in `docker-compose.yml`:

1.  **leo-gateway**: The central API gateway and backend service.
    *   **Role**: Handles all client requests, manages authentication, processes documents for RAG (parsing, chunking, embedding), and routes chat requests to agents or directly to LLMs.
    *   **Tech Stack**: Node.js, TypeScript, Express.
    *   **Key Services**: `agent-tools`, `chat`, `hybrid-search`, `ocr`, `pu-charging` (billing).
    *   **Ports**: Exposed on `8080`.

2.  **agent-orchestrator**: Manages the runtime of AI agents.
    *   **Role**: Responsible for spinning up, monitoring, and stopping agent containers.
    *   **Tech Stack**: Node.js, TypeScript.
    *   **Integration**: Communicates with `leo-gateway` and the Docker daemon.
    *   **Ports**: Exposed on `8081`.

3.  **litellm**: An LLM Gateway / Proxy.
    *   **Role**: Standardizes API calls to various LLM providers (OpenAI, Anthropic, etc.), handles logging, and tracks costs/usage.
    *   **Tech Stack**: Python (LiteLLM).
    *   **Ports**: Exposed on `4000`.

4.  **chroma**: Vector Database.
    *   **Role**: Stores embeddings for document retrieval (RAG).
    *   **Tech Stack**: ChromaDB.
    *   **Ports**: Exposed on `8000`.

5.  **litellm-db**: PostgreSQL database.
    *   **Role**: Dedicated database for LiteLLM to store logs and usage data.

## Deployment Instructions

### Prerequisites

*   Docker and Docker Compose
*   Node.js (for local development)
*   External Network: `leo_default` (must be created before running)

### Setup Steps

1.  **Create Docker Network**:
    ```bash
    docker network create leo_default
    ```

2.  **Environment Configuration**:
    Ensure the `.env` file is populated with necessary keys:
    *   `OPENAI_API_KEY`: API key for OpenAI.
    *   `ANTHROPIC_API_KEY`: API key for Anthropic (optional).
    *   `DATABASE_URL`: Connection string for the main application database.
    *   `LITELLM_MASTER_KEY`: Master key for LiteLLM admin access.

3.  **Start Services**:
    Run the following command to build and start all services:
    ```bash
    docker-compose up -d --build
    ```

4.  **Verification**:
    *   **Gateway**: `http://localhost:8080/health` (if implemented) or check logs.
    *   **LiteLLM UI**: `http://localhost:4000/ui`
    *   **Chroma**: `http://localhost:8000/api/v1/heartbeat`

## Key Directories & Files

*   `services/leo-gateway/src/routes`: API Route definitions.
*   `services/leo-gateway/src/services`: Core business logic (search, chat, tools).
*   `services/agent-orchestrator`: Agent management logic.
*   `docker-compose.yml`: Infrastructure definition.

## Context for AI Agents

When working on this codebase:
*   **Billing/Usage**: Logic is handled in `leo-gateway/src/services/pu-charging.service.ts` and `usage.service.ts`.
*   **RAG/Search**: Look into `leo-gateway/src/services/hybrid-search.service.ts`, `chroma.service.ts`, and `fts.service.ts`.
*   **LLM Interactions**: routed through `litellm.service.ts` which calls the `litellm` container.
*   **Agent Tools**: Defined in `leo-gateway/src/services/agent-tools.service.ts`.
