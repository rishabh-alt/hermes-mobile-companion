import { describe, expect, it, vi } from "vitest";
import { steerRun, transcriptText } from "./steer";
import { defaultConfig } from "./config";

describe("steerRun", () => {
  it("posts the chat bearer to the host steer door", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await steerRun(
      { ...defaultConfig, baseUrl: "https://example.com", token: "private-token" },
      "run_abc",
      "look at the tests",
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://example.com/v1/runs/run_abc/steer");
    expect(fetchMock.mock.calls[0]?.[1]?.headers?.Authorization).toBe("Bearer private-token");
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      text: "look at the tests",
    });
    vi.unstubAllGlobals();
  });
});

describe("transcriptText", () => {
  it("copies the chat without a tool dump", () => {
    expect(
      transcriptText([
        { role: "user", text: "hi" },
        { role: "assistant", text: "" },
      ]),
    ).toBe("user: hi");
  });
});
