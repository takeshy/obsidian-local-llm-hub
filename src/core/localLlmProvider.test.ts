import { beforeEach, describe, expect, it, vi } from "vitest";

const requestUrl = vi.hoisted(() => vi.fn());

vi.mock("obsidian", () => ({ requestUrl }));

import { fetchEmbeddingModels } from "./localLlmProvider";
import type { LocalLlmConfig } from "../types";

const config: LocalLlmConfig = {
  framework: "ollama",
  baseUrl: "http://localhost:11434",
  apiKey: "",
  model: "",
};

describe("fetchEmbeddingModels", () => {
  beforeEach(() => {
    requestUrl.mockReset();
  });

  it("includes Ollama embedding models identified by name as well as family", async () => {
    requestUrl.mockResolvedValue({
      json: {
        models: [
          { name: "nomic-embed-text:latest", details: { families: ["nomic-bert"] } },
          { name: "qwen3-embedding:8b-q8_0", details: { families: ["qwen3"] } },
          { name: "qwen3:8b", details: { families: ["qwen3"] } },
        ],
      },
    });

    await expect(fetchEmbeddingModels(config)).resolves.toEqual([
      "nomic-embed-text:latest",
      "qwen3-embedding:8b-q8_0",
    ]);
  });

  it("removes a trailing slash from the Ollama embedding server URL", async () => {
    requestUrl.mockResolvedValue({ json: { models: [] } });

    await fetchEmbeddingModels(config, "http://localhost:11434/");

    expect(requestUrl).toHaveBeenCalledWith({
      url: "http://localhost:11434/api/tags",
      method: "GET",
    });
  });
});
