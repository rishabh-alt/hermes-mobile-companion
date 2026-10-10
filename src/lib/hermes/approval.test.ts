import { afterEach, describe, expect, it, vi } from "vitest";
import { parseApprovalRequest, respondToApproval } from "./approval";
import { defaultConfig } from "./config";

afterEach(() => vi.unstubAllGlobals());

describe("parseApprovalRequest", () => {
  it("keeps the command and only the choices the host offered", () => {
    expect(
      parseApprovalRequest({
        run_id: "run-1",
        command: "rm notes.txt",
        choices: ["once", "session", "always", "deny", "sudo"],
        request_id: "req-1",
      }),
    ).toEqual({
      runId: "run-1",
      command: "rm notes.txt",
      choices: ["once", "session", "always", "deny"],
      requestId: "req-1",
    });
  });
});

describe("respondToApproval", () => {
  it("posts the choice with the chat token and not an admin header", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await respondToApproval(
      { ...defaultConfig, baseUrl: "https://example.com", token: "chat-token" },
      { runId: "run-1", choice: "once", requestId: "req-1" },
    );

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.com/v1/runs/run-1/approval");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ choice: "once", request_id: "req-1" });
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer chat-token");
    expect((init.headers as Record<string, string>)["X-Hermes-Admin-Key"]).toBeUndefined();
  });
});
