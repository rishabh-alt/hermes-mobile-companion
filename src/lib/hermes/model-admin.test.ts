import { afterEach, describe, expect, it, vi } from "vitest";
import { saveHostModel } from "./model-admin";
import type { HermesConfig } from "./types";

const config = {
  baseUrl: "https://host.example",
  token: "chat-token",
  adminToken: "admin-key-0123456789",
  activeProfile: "default",
  profilePathPrefix: "",
  provider: "",
  model: "",
  fallbackModel: "",
  wsEnabled: true,
  haptics: true,
  reasoning: "medium",
  fastMode: false,
} satisfies HermesConfig;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveHostModel", () => {
  it("sends the admin key in its own header and never the chat token", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ model: "gpt-5.6-sol" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await saveHostModel(config, { model: "gpt-5.6-sol", reasoning_effort: "high" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://host.example/api/admin/model");
    expect(init.method).toBe("PATCH");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Hermes-Admin-Key"]).toBe("admin-key-0123456789");
    expect(JSON.stringify(init)).not.toContain("chat-token");
    expect(init.body).toBe(JSON.stringify({ model: "gpt-5.6-sol", reasoning_effort: "high" }));
  });
});
