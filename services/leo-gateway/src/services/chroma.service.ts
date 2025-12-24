import { ChromaClient, Collection, IEmbeddingFunction } from 'chromadb';
import { OpenAIEmbeddings } from '@langchain/openai';
import { config } from '../config';
import { DocumentChunk } from './parser.service';

class OpenAIEmbeddingFunction implements IEmbeddingFunction {
    private embeddings: OpenAIEmbeddings;

    constructor() {
        if (!config.openaiApiKey) {
            throw new Error('OPENAI_API_KEY is required for embeddings');
        }

        this.embeddings = new OpenAIEmbeddings({
            openAIApiKey: config.openaiApiKey,
            model: config.embeddingModel,
        });
    }

    async generate(texts: string[]): Promise<number[][]> {
        return await this.embeddings.embedDocuments(texts);
    }
}

class ChromaService {
    private client: ChromaClient;
    private embeddingFunction: OpenAIEmbeddingFunction | null = null;

    constructor() {
        const url = new URL(config.chromaUrl);
        this.client = new ChromaClient({
            path: config.chromaUrl,
        });
    }

    private getEmbeddingFunction(): OpenAIEmbeddingFunction {
        if (!this.embeddingFunction) {
            this.embeddingFunction = new OpenAIEmbeddingFunction();
        }
        return this.embeddingFunction;
    }

    async getOrCreateCollection(agentId: string): Promise<Collection> {
        const collectionName = `agent_${agentId}`;

        return await this.client.getOrCreateCollection({
            name: collectionName,
            embeddingFunction: this.getEmbeddingFunction(),
        });
    }

    async addDocuments(agentId: string, chunks: DocumentChunk[]): Promise<void> {
        const collection = await this.getOrCreateCollection(agentId);

        // Generate embeddings
        const embeddings = await this.getEmbeddingFunction().generate(
            chunks.map(c => c.content)
        );

        await collection.add({
            ids: chunks.map(c => c.id),
            documents: chunks.map(c => c.content),
            embeddings: embeddings,
            metadatas: chunks.map(c => c.metadata),
        });
    }

    async searchDocuments(
        agentId: string,
        query: string,
        nResults: number = 3
    ): Promise<{ content: string; metadata: any; score: number }[]> {
        const collection = await this.getOrCreateCollection(agentId);

        // Generate query embedding
        const queryEmbedding = await this.getEmbeddingFunction().generate([query]);

        const results = await collection.query({
            queryEmbeddings: queryEmbedding,
            nResults,
        });

        if (!results.documents || !results.documents[0]) {
            return [];
        }

        return results.documents[0].map((doc, index) => ({
            content: doc || '',
            metadata: results.metadatas?.[0]?.[index] || {},
            score: results.distances?.[0]?.[index] ? 1 - results.distances[0][index] : 0,
        }));
    }

    async deleteCollection(agentId: string): Promise<void> {
        const collectionName = `agent_${agentId}`;

        try {
            await this.client.deleteCollection({ name: collectionName });
        } catch (error) {
            // Collection might not exist
            console.log(`Collection ${collectionName} not found, skipping delete`);
        }
    }

    async deleteDocuments(agentId: string, where: any): Promise<void> {
        try {
            const collection = await this.getOrCreateCollection(agentId);
            await collection.delete({
                where: where,
            });
        } catch (error) {
            console.error(`Failed to delete documents for agent ${agentId}`, error);
            throw error;
        }
    }

    async getCollectionInfo(agentId: string): Promise<{ count: number } | null> {
        try {
            const collection = await this.getOrCreateCollection(agentId);
            const count = await collection.count();
            return { count };
        } catch (error) {
            return null;
        }
    }
}

export const chromaService = new ChromaService();
