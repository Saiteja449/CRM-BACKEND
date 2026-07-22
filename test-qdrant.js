import dotenv from 'dotenv'; dotenv.config();
import { QdrantClient } from "@qdrant/js-client-rest";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { QdrantVectorStore } from "@langchain/qdrant";

async function test() {
  const client = new QdrantClient({
    url: process.env.CLUSTER_ENDPOINT,
    apiKey: process.env.QDRANT_API_KEY,
  });

  const embeddings = new GoogleGenerativeAIEmbeddings({
    apiKey: process.env.GEMINI_API_KEY,
    model: "gemini-embedding-2",
  });

  const qdrantVectorStore = new QdrantVectorStore(embeddings, {
    client,
    collectionName: "petsfolio_kb",
  });

  const results = await qdrantVectorStore.similaritySearch('how to login mobile number otp', 5);
  console.log(JSON.stringify(results, null, 2));
}

test().catch(console.error);
