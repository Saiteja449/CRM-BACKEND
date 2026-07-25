import dotenv from 'dotenv'; dotenv.config();
import { QdrantClient } from "@qdrant/js-client-rest";
import { OllamaEmbeddings } from "@langchain/ollama";
import { QdrantVectorStore } from "@langchain/qdrant";

async function test() {
  const client = new QdrantClient({
    url: process.env.CLUSTER_ENDPOINT,
    apiKey: process.env.QDRANT_API_KEY,
  });

  const embeddings = new OllamaEmbeddings({
    model: "nomic-embed-text",
    baseUrl: "http://localhost:11434",
  });

  const qdrantVectorStore = new QdrantVectorStore(embeddings, {
    client,
    collectionName: "petsfolio_kb",
  });

  const results = await qdrantVectorStore.similaritySearch('search_query: how to login mobile number otp', 5);
  console.log(JSON.stringify(results, null, 2));
}

test().catch(console.error);
