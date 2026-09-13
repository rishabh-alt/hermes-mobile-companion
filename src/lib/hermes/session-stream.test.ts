import { afterEach, describe, expect, it, vi } from "vitest";
import { streamGatewaySession } from "./session-api";
import { defaultConfig } from "./config";

afterEach(() => vi.unstubAllGlobals());

describe("streamGatewaySession", () => {
  it("parses named complete SSE frames from the session stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            [
              "event: assistant.delta\n",
              'data: {"delta":"Hello"}\n\n',
              "event: assistant.completed\n",
              'data: {"content":"Hello world","runtime":{"provider":"openai-codex","model":"gpt-5.6-terra"}}\n\n',
              "event: done\n",
              "data: {}\n\n",
            ].join(""),
            { status: 200 },
          ),
        ),
    );
    const text: string[] = [];
    const completed = vi.fn();

    await streamGatewaySession({
      config: { ...defaultConfig, baseUrl: "https://example.com", token: "private-token" },
      sessionId: "server-session",
      message: "Hi",
      provider: "openai-codex",
      model: "gpt-5.6-terra",
      signal: new AbortController().signal,
      handlers: { onText: (delta) => text.push(delta), onCompleted: completed, onError: vi.fn() },
    });

    expect(text).toEqual(["Hello"]);
    expect(completed).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Hello world",
        runtime: { provider: "openai-codex", model: "gpt-5.6-terra" },
      }),
    );
  });

  it("rejects an SSE connection that closes before assistant completion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("event: done\ndata: {}\n\n", { status: 200 })),
    );

    await expect(
      streamGatewaySession({
        config: { ...defaultConfig, baseUrl: "https://example.com", token: "private-token" },
        sessionId: "server-session",
        message: "Hi",
        provider: "openai-codex",
        model: "gpt-5.6-terra",
        signal: new AbortController().signal,
        handlers: { onText: vi.fn(), onCompleted: vi.fn(), onError: vi.fn() },
      }),
    ).rejects.toThrow("ended before Hermes completed the turn");
  });

  it("forwards image-only content instead of collapsing it to an empty message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response('event: assistant.completed\ndata: {"content":"ok"}\n\n', { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await streamGatewaySession({
      config: { ...defaultConfig, baseUrl: "https://example.com", token: "private-token" },
      sessionId: "server-session",
      message: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }],
      provider: "openai-codex",
      model: "gpt-5.6-terra",
      signal: new AbortController().signal,
      handlers: { onText: vi.fn(), onCompleted: vi.fn(), onError: vi.fn() },
    });

    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string).message).toEqual([
      { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } },
    ]);
  });
});
