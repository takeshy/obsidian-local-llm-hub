/**
 * RAG integration tests
 * Requires Ollama running at localhost:11434
 * Run with: npm run test:integration
 */
import { describe, it, expect, beforeAll } from "vitest";
import { chunkText, cosineSimilarity } from "./ragStore";

const OLLAMA_BASE_URL = "http://localhost:11434";
const EMBEDDING_MODEL = "nomic-embed-text";

// Skip all tests if INTEGRATION env var is not set
const runIntegration = !!process.env.INTEGRATION;

/**
 * Generate embeddings via Ollama's OpenAI-compatible API
 */
async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await fetch(`${OLLAMA_BASE_URL}/v1/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
    }),
  });
  if (!response.ok) {
    throw new Error(`Embedding request failed: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  const sorted = [...data.data].sort(
    (a: { index: number }, b: { index: number }) => a.index - b.index
  );
  return sorted.map((d: { embedding: number[] }) => d.embedding);
}

async function generateEmbedding(text: string): Promise<number[]> {
  const results = await generateEmbeddings([text]);
  return results[0];
}

describe.skipIf(!runIntegration)("RAG Integration Tests", () => {
  beforeAll(async () => {
    // Verify Ollama is reachable
    try {
      const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
      if (!res.ok) throw new Error("Ollama not reachable");
    } catch (e) {
      throw new Error(
        `Ollama is not running at ${OLLAMA_BASE_URL}. Start it first.\n${e}`
      );
    }

    // Verify embedding model is available
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    const data = await res.json();
    const models = data.models?.map((m: { name: string }) => m.name) || [];
    const hasModel = models.some((name: string) =>
      name.startsWith(EMBEDDING_MODEL)
    );
    if (!hasModel) {
      throw new Error(
        `Model "${EMBEDDING_MODEL}" not found. Available: ${models.join(", ")}.\n` +
          `Run: ollama pull ${EMBEDDING_MODEL}`
      );
    }
  });

  describe("Embedding generation", () => {
    it("generates embedding vector for a single text", async () => {
      const embedding = await generateEmbedding("Hello, world!");
      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBeGreaterThan(0);
      // nomic-embed-text has 768 dimensions
      expect(embedding.length).toBe(768);
      // Values should be finite numbers
      for (const val of embedding) {
        expect(Number.isFinite(val)).toBe(true);
      }
    });

    it("generates embeddings for batch of texts", async () => {
      const texts = ["First text", "Second text", "Third text"];
      const embeddings = await generateEmbeddings(texts);
      expect(embeddings).toHaveLength(3);
      for (const emb of embeddings) {
        expect(emb.length).toBe(768);
      }
    });

    it("generates different embeddings for different texts", async () => {
      const [emb1, emb2] = await generateEmbeddings([
        "The cat sat on the mat",
        "Quantum physics describes subatomic particles",
      ]);
      // Should not be identical
      const vec1 = new Float32Array(emb1);
      const vec2 = new Float32Array(emb2);
      const similarity = cosineSimilarity(vec1, vec2);
      expect(similarity).toBeLessThan(0.95);
    });

    it("generates embeddings for Japanese text", async () => {
      const embedding = await generateEmbedding(
        "Obsidianはナレッジベースのノートアプリです"
      );
      expect(embedding.length).toBe(768);
    });
  });

  describe("Semantic similarity", () => {
    it("similar texts have high cosine similarity", async () => {
      const [emb1, emb2] = await generateEmbeddings([
        "The weather is sunny and warm today",
        "Today is a bright and warm sunny day",
      ]);
      const similarity = cosineSimilarity(
        new Float32Array(emb1),
        new Float32Array(emb2)
      );
      expect(similarity).toBeGreaterThan(0.8);
    });

    it("dissimilar texts have lower cosine similarity", async () => {
      const [emb1, emb2] = await generateEmbeddings([
        "The weather is sunny and warm today",
        "Machine learning algorithms optimize neural networks",
      ]);
      const similarity = cosineSimilarity(
        new Float32Array(emb1),
        new Float32Array(emb2)
      );
      expect(similarity).toBeLessThan(0.7);
    });

    it("similar > dissimilar for related text triplet", async () => {
      const [embQuery, embRelated, embUnrelated] = await generateEmbeddings([
        "How to install Obsidian plugins",
        "Setting up and configuring Obsidian community plugins",
        "Recipe for chocolate cake with vanilla frosting",
      ]);
      const qVec = new Float32Array(embQuery);
      const relatedScore = cosineSimilarity(qVec, new Float32Array(embRelated));
      const unrelatedScore = cosineSimilarity(
        qVec,
        new Float32Array(embUnrelated)
      );
      expect(relatedScore).toBeGreaterThan(unrelatedScore);
    });
  });

  describe("End-to-end: chunk + embed + search", () => {
    it("finds the most relevant chunk for a query", async () => {
      // Simulate a document with distinct sections
      const document = [
        "# Introduction\nThis document describes the architecture of the application.",
        "# Database\nThe application uses PostgreSQL for persistent storage. Tables are normalized to third normal form.",
        "# Authentication\nUsers authenticate via OAuth2 with JWT tokens. Sessions expire after 24 hours.",
        "# Deployment\nThe app is deployed on Kubernetes using Helm charts. CI/CD runs on GitHub Actions.",
      ].join("\n\n");

      // Chunk the document
      const chunks = chunkText(document, 200, 50);
      expect(chunks.length).toBeGreaterThanOrEqual(3);

      // Embed all chunks
      const chunkTexts = chunks.map((c) => c.text);
      const chunkEmbeddings = await generateEmbeddings(chunkTexts);

      // Search for database-related query
      const queryEmb = await generateEmbedding(
        "What database does the application use?"
      );
      const queryVec = new Float32Array(queryEmb);

      // Compute similarities
      const scores = chunkEmbeddings.map((emb, idx) => ({
        idx,
        text: chunks[idx].text,
        score: cosineSimilarity(queryVec, new Float32Array(emb)),
      }));
      scores.sort((a, b) => b.score - a.score);

      // The top result should contain "PostgreSQL" or "Database"
      const topResult = scores[0];
      expect(
        topResult.text.includes("PostgreSQL") ||
          topResult.text.includes("Database")
      ).toBe(true);
    });

    it("ranks relevant chunks higher with Japanese text", async () => {
      const document = [
        "# 概要\nこのプラグインはObsidianでローカルLLMを使用するためのツールです。",
        "# RAG機能\nRAGはRetrieval-Augmented Generationの略です。ノートの内容をベクトル化して検索に使います。",
        "# 暗号化\nファイルの暗号化にはAES-GCMを使用しています。パスワードで保護できます。",
        "# ワークフロー\nYAMLベースのワークフロー自動化エンジンを搭載しています。",
      ].join("\n\n");

      const chunks = chunkText(document, 150, 30);
      const chunkTexts = chunks.map((c) => c.text);
      const chunkEmbeddings = await generateEmbeddings(chunkTexts);

      const queryEmb = await generateEmbedding("RAGとは何ですか？");
      const queryVec = new Float32Array(queryEmb);

      const scores = chunkEmbeddings.map((emb, idx) => ({
        idx,
        text: chunks[idx].text,
        score: cosineSimilarity(queryVec, new Float32Array(emb)),
      }));
      scores.sort((a, b) => b.score - a.score);

      // The top result should contain "RAG"
      expect(scores[0].text).toContain("RAG");
    });
  });
});
