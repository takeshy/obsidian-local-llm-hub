import { describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => ({ TFile: class TFile {} }));
import { listDashboardModels } from "./dashboardHubCapabilities";

describe("Dashboard Hub AI integration contract", () => {
  it("exposes configured local models with Vault capabilities", () => {
    const models = listDashboardModels({ settings: { llmConfig: { model: "llama" }, availableModels: ["llama", "qwen"] } } as never);
    expect(models.map((model) => model.id)).toEqual(["llama", "qwen"]);
    expect(models.every((model) => model.capabilities.text && model.capabilities.vaultRead && model.capabilities.tools)).toBe(true);
  });
});
