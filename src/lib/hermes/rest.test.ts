import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchModelOptions } from "./rest";

const config = {
  baseUrl: "https://example.com",
  token: "private-token",
  activeProfile: "default",
  profilePathPrefix: "",
  provider: "",
  model: "",
  fallbackModel: "",
  wsEnabled: false,
  haptics: false,
  reasoning: "medium" as const,
  fastMode: false,
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          provider: "openai-codex",
          model: "gpt-5.6-terra",
          providers: [
            {
              slug: "openai-codex",
              name: "ChatGPT or Codex Subscription",
              authenticated: true,
              is_current: true,
              models: ["gpt-5.6-terra"],
            },
          ],
        }),
        { status: 200 },
      ),
    ),
  );
});

describe("fetchModelOptions", () => {
  it("requests the typed gateway inventory and preserves provider identity", async () => {
    const snapshot = await fetchModelOptions(config);

    expect(snapshot.activeProvider).toBe("openai-codex");
    expect(snapshot.activeModel).toBe("gpt-5.6-terra");
    expect(snapshot.providers[0]).toMatchObject({
      slug: "openai-codex",
      models: ["gpt-5.6-terra"],
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/api/model/options",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer private-token" }),
      }),
    );
  });

  it("adds refresh only when explicitly requested", async () => {
    await fetchModelOptions(config, { refresh: true });

    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/api/model/options?refresh=1",
      expect.any(Object),
    );
  });
});
