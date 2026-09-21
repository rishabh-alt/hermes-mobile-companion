import { describe, expect, it } from "vitest";
import { visibleProviderModels } from "./route-picker";
import type { ModelOptionsSnapshot } from "./model-options";

const snapshot: ModelOptionsSnapshot = {
  activeProvider: "openai-codex",
  activeModel: "gpt-5.6-terra",
  providers: [
    {
      slug: "openai-codex",
      name: "ChatGPT or Codex Subscription",
      authenticated: true,
      isCurrent: true,
      models: ["gpt-5.6-terra", "gpt-5.6-sol"],
      featuredModels: [],
      unavailableModels: [],
      capabilities: {},
    },
    {
      slug: "gemini",
      name: "Google AI Studio",
      authenticated: true,
      isCurrent: false,
      models: ["gemini-3.1-pro-preview"],
      featuredModels: [],
      unavailableModels: [],
      capabilities: {},
    },
    {
      slug: "anthropic",
      name: "Anthropic",
      authenticated: false,
      isCurrent: false,
      models: ["claude-fable"],
      featuredModels: [],
      unavailableModels: [],
      capabilities: {},
    },
  ],
};

describe("visibleProviderModels", () => {
  it("keeps authenticated providers and promotes the active provider", () => {
    expect(visibleProviderModels(snapshot, "").map((provider) => provider.slug)).toEqual([
      "openai-codex",
      "gemini",
    ]);
  });

  it("matches provider names and model ids without exposing unconfigured providers", () => {
    expect(visibleProviderModels(snapshot, "gemini")).toEqual([
      expect.objectContaining({ slug: "gemini", models: ["gemini-3.1-pro-preview"] }),
    ]);
    expect(visibleProviderModels(snapshot, "claude")).toEqual([]);
  });
});
