import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activateSessionProfile,
  clearSessionCache,
  importGatewaySession,
  readSessions,
} from "./sessions";

afterEach(() => {
  clearSessionCache();
  activateSessionProfile("default");
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

  it("keeps identical session ids isolated between profiles", () => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal("CustomEvent", class {});

    importGatewaySession("shared-id", "Default chat", [], "default-model", "default-provider");
    activateSessionProfile("research");
    expect(readSessions()).toEqual([]);

    importGatewaySession("shared-id", "Research chat", [], "research-model", "research-provider");
    expect(readSessions()[0]).toMatchObject({ title: "Research chat", model: "research-model" });

    activateSessionProfile("default");
    expect(readSessions()[0]).toMatchObject({ title: "Default chat", model: "default-model" });
  });

  it("rejects unsafe profile cache identities", () => {
    expect(() => activateSessionProfile("../default")).toThrow(/profile/i);
  });
});
