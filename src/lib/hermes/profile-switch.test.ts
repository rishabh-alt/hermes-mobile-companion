import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "./config";
import { prepareProfileSwitch } from "./profile-switch";

const payload = {
  current_profile: "default",
  profiles: [
    {
      name: "default",
      label: "Default",
      is_default: true,
      is_current: true,
      path_prefix: "",
    },
    {
      name: "research",
      label: "Research",
      is_default: false,
      is_current: false,
      path_prefix: "/p/research",
    },
  ],
};

const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

afterEach(() => vi.unstubAllGlobals());

describe("prepareProfileSwitch", () => {
  it("preflights inventory, health, models, and sessions before returning a config patch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(payload))
      .mockResolvedValueOnce(json({ status: "ok" }))
      .mockResolvedValueOnce(
        json({
          provider: "openai-codex",
          model: "gpt-5.6-terra",
          providers: [
            {
              slug: "openai-codex",
              name: "Codex",
              authenticated: true,
              is_current: true,
              models: ["gpt-5.6-terra"],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(json({ sessions: [{ id: "research-session", title: "Notes" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const config = {
      ...defaultConfig,
      baseUrl: "https://example.com",
      token: "unchanged-token",
      provider: "old-provider",
      model: "old-model",
    };

    const prepared = await prepareProfileSwitch(config, "research");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://example.com/api/profiles",
      "https://example.com/p/research/api/status",
      "https://example.com/p/research/api/model/options",
      "https://example.com/p/research/api/sessions?limit=60&offset=0&min_messages=0",
    ]);
    expect(prepared.configPatch).toEqual({
      activeProfile: "research",
      profilePathPrefix: "/p/research",
      provider: "openai-codex",
      model: "gpt-5.6-terra",
      fallbackModel: "",
    });
    expect(prepared.sessions).toEqual([expect.objectContaining({ id: "research-session" })]);
    expect(config).toMatchObject({
      activeProfile: "default",
      profilePathPrefix: "",
      provider: "old-provider",
      model: "old-model",
      token: "unchanged-token",
    });
  });

  it("rejects an unknown target before any target-profile read", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(payload));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      prepareProfileSwitch(
        { ...defaultConfig, baseUrl: "https://example.com", token: "unchanged-token" },
        "missing",
      ),
    ).rejects.toThrow(/not present/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["empty health", {}],
    ["malformed health", []],
  ])("fails transactionally on %s", async (_label, health) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(payload))
      .mockResolvedValueOnce(json(health))
      .mockResolvedValueOnce(
        json({ provider: "p", model: "m", providers: [{ slug: "p", name: "P", models: ["m"] }] }),
      )
      .mockResolvedValueOnce(json({ sessions: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      prepareProfileSwitch(
        { ...defaultConfig, baseUrl: "https://example.com", provider: "old", model: "old" },
        "research",
      ),
    ).rejects.toThrow(/health/i);
  });

  it("rejects malformed session readback rather than silently using an empty list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(payload))
      .mockResolvedValueOnce(json({ status: "ok" }))
      .mockResolvedValueOnce(
        json({ provider: "p", model: "m", providers: [{ slug: "p", name: "P", models: ["m"] }] }),
      )
      .mockResolvedValueOnce(json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      prepareProfileSwitch({ ...defaultConfig, baseUrl: "https://example.com" }, "research"),
    ).rejects.toThrow(/session/i);
  });
});
