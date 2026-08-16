import { beforeEach, describe, expect, it, vi } from "vitest";

const requestUrl = vi.hoisted(() => vi.fn());

vi.mock("obsidian", () => ({ requestUrl }));

import { generateEmbeddings } from "./embeddingProvider";
import { DEFAULT_RAG_SETTING, type LocalLlmConfig } from "../types";

const config: LocalLlmConfig = {
  framework: "ollama",
  baseUrl: "http://localhost:11434",
  apiKey: "",
  model: "",
};

describe("generateEmbeddings", () => {
  beforeEach(() => {
    requestUrl.mockReset();
    requestUrl.mockResolvedValue({
      json: { data: [{ embedding: [1, 2, 3], index: 0 }] },
    });
  });

  it("removes a trailing slash from the embedding server URL", async () => {
    await generateEmbeddings(
      ["test"],
      {
        ...DEFAULT_RAG_SETTING,
        embeddingBaseUrl: "http://localhost:11434/",
        embeddingModel: "nomic-embed-text:latest",
      },
      config,
    );

    expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
      url: "http://localhost:11434/v1/embeddings",
    }));
  });
});
