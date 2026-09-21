import { describe, expect, it } from "vitest";
import { parseModelOptions } from "./model-options";

describe("parseModelOptions", () => {
  it("preserves the active route and configured provider groups", () => {
    const snapshot = parseModelOptions({
      provider: "openai-codex",
      model: "gpt-5.6-terra",
      providers: [
        {
          slug: "openai-codex",
          name: "ChatGPT or Codex Subscription",
          authenticated: true,
          is_current: true,
          models: ["gpt-5.6-terra", "gpt-5.6-sol"],
          capabilities: {
            "gpt-5.6-terra": { fast: true, reasoning: true, can_disable_reasoning: true },
          },
        },
        {
          slug: "gemini",
          name: "Google AI Studio",
          authenticated: false,
          models: ["gemini-3.1-pro-preview"],
        },
      ],
    });

    expect(snapshot.activeProvider).toBe("openai-codex");
    expect(snapshot.activeModel).toBe("gpt-5.6-terra");
    expect(snapshot.providers).toEqual([
      {
        slug: "openai-codex",
        name: "ChatGPT or Codex Subscription",
        authenticated: true,
        isCurrent: true,
        models: ["gpt-5.6-terra", "gpt-5.6-sol"],
        featuredModels: [],
        unavailableModels: [],
        warning: undefined,
        capabilities: {
          "gpt-5.6-terra": { fast: true, reasoning: true, canDisableReasoning: true },
        },
      },
      {
        slug: "gemini",
        name: "Google AI Studio",
        authenticated: false,
        isCurrent: false,
        models: ["gemini-3.1-pro-preview"],
        featuredModels: [],
        unavailableModels: [],
        warning: undefined,
        capabilities: {},
      },
    ]);
  });

  it("drops malformed provider rows without treating the payload as a model list", () => {
    const snapshot = parseModelOptions({
      provider: "openai-codex",
      model: "gpt-5.6-terra",
      providers: [{ slug: "", name: "Missing slug", models: ["ignored"] }, "not-a-provider"],
    });

    expect(snapshot.providers).toEqual([]);
    expect(snapshot.activeProvider).toBe("openai-codex");
    expect(snapshot.activeModel).toBe("gpt-5.6-terra");
  });

  it("rejects payloads without a providers array", () => {
    expect(() => parseModelOptions({ models: ["not-the-contract"] })).toThrow(
      "Malformed model-options response",
    );
  });
});
