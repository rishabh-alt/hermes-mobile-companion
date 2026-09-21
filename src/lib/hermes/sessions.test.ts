import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSessionCache, importGatewaySession, readSessions } from "./sessions";

afterEach(() => {
  clearSessionCache();
  vi.unstubAllGlobals();
});

describe("session cache", () => {
  it("keeps a pulled server transcript only in memory", () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn() };
    vi.stubGlobal("window", {
      localStorage: storage,
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal("CustomEvent", class {});

    importGatewaySession("server-id", "Server chat", [], "gpt-5.6-terra", "openai-codex");

    expect(readSessions()).toEqual([
      expect.objectContaining({
        id: "server-id",
        title: "Server chat",
        provider: "openai-codex",
        model: "gpt-5.6-terra",
      }),
    ]);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
