import { describe, expect, it, vi } from "vitest";
import { streamChat } from "./client";
import { defaultConfig } from "./config";

describe("streamChat", () => {
  it("sends the selected provider alongside its model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const text: string[] = [];
    await streamChat({
      config: { ...defaultConfig, baseUrl: "https://example.com", token: "private-token" },
      provider: "openai-codex",
      model: "gpt-5.6-terra",
      messages: [{ id: "u1", role: "user", text: "Hi", createdAt: 1 }],
      signal: new AbortController().signal,
      handlers: { onText: (delta) => text.push(delta), onReasoning: vi.fn(), onTools: vi.fn() },
    });

    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      provider: "openai-codex",
      model: "gpt-5.6-terra",
    });
    expect(text).toEqual(["ok"]);
  });
});
