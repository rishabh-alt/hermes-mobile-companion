import { afterEach, describe, expect, it, vi } from "vitest";
import { createGatewaySession, lockSessionRuntime } from "./session-api";
import { defaultConfig } from "./config";

afterEach(() => vi.unstubAllGlobals());

describe("createGatewaySession", () => {
  it("uses the server-issued id returned from POST /api/sessions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          session: {
            id: "server-issued-session-id",
            title: "New chat",
            created_at: "2026-09-12T20:00:00Z",
            updated_at: "2026-09-12T20:00:00Z",
            messages: [],
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const session = await createGatewaySession({
      ...defaultConfig,
      baseUrl: "https://example.com",
      token: "private-token",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/api/sessions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(session).toMatchObject({ id: "server-issued-session-id", title: "New chat" });
  });

  it("sends provider and model together and returns the acknowledged runtime", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          runtime: { provider: "openai-codex", model: "gpt-5.6-terra", model_lock: true },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const runtime = await lockSessionRuntime(
      { ...defaultConfig, baseUrl: "https://example.com", token: "private-token" },
      "server-issued-session-id",
      { provider: "openai-codex", model: "gpt-5.6-terra" },
    );

    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      provider: "openai-codex",
      model: "gpt-5.6-terra",
    });
    expect(runtime).toEqual({ provider: "openai-codex", model: "gpt-5.6-terra", locked: true });
  });
});
