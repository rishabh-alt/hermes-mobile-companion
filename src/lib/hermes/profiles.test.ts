import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "./config";
import { composeGatewayUrl, parseProfileInventory } from "./profiles";
import { api, fetchProfileInventory } from "./rest";
import { HermesRpc } from "./rpc";

afterEach(() => vi.unstubAllGlobals());

const inventoryPayload = {
  current_profile: "default",
  profiles: [
    {
      name: "default",
      label: "Default",
      is_default: true,
      is_current: true,
      path_prefix: "",
      provider: "openai-codex",
      model: "gpt-5.6-terra",
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

describe("profile inventory and URL composition", () => {
  it("parses the authoritative default and named profile routes", () => {
    const inventory = parseProfileInventory(inventoryPayload);

    expect(inventory.currentProfile).toBe("default");
    expect(inventory.profiles).toEqual([
      expect.objectContaining({ name: "default", pathPrefix: "", isDefault: true }),
      expect.objectContaining({ name: "research", pathPrefix: "/p/research" }),
    ]);
  });

  it("composes default and named URLs without mutating the canonical root", () => {
    expect(
      composeGatewayUrl({ ...defaultConfig, baseUrl: "https://example.com" }, "/api/sessions"),
    ).toBe("https://example.com/api/sessions");
    expect(
      composeGatewayUrl(
        {
          ...defaultConfig,
          baseUrl: "https://example.com/root/",
          activeProfile: "research",
          profilePathPrefix: "/p/research",
        },
        "/api/sessions?limit=10",
      ),
    ).toBe("https://example.com/root/p/research/api/sessions?limit=10");
  });

  it.each([
    { name: "../admin", path_prefix: "/p/../admin" },
    { name: "research%2Fadmin", path_prefix: "/p/research%2Fadmin" },
    { name: "research", path_prefix: "/p/research?profile=admin" },
    { name: "research", path_prefix: "/p/%72esearch" },
  ])("rejects unsafe server supplied profile routes: $path_prefix", (unsafe) => {
    expect(() =>
      parseProfileInventory({
        current_profile: unsafe.name,
        profiles: [
          {
            ...unsafe,
            label: "Unsafe",
            is_default: false,
            is_current: true,
          },
        ],
      }),
    ).toThrow(/malformed profile inventory/i);
  });

  it("scopes normal REST reads while profile inventory always bypasses to root", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(inventoryPayload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const config = {
      ...defaultConfig,
      baseUrl: "https://example.com",
      activeProfile: "research",
      profilePathPrefix: "/p/research",
    };

    await api(config, "/api/status");
    const inventory = await fetchProfileInventory(config);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://example.com/p/research/api/status");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://example.com/api/profiles");
    expect(inventory.currentProfile).toBe("default");
  });

  it("scopes the realtime RPC channel without putting the profile in the token", () => {
    const rpc = new HermesRpc({
      ...defaultConfig,
      baseUrl: "https://example.com",
      token: "unchanged-token",
      activeProfile: "research",
      profilePathPrefix: "/p/research",
    });

    expect(rpc.url()).toBe("wss://example.com/p/research/ws?token=unchanged-token");
  });
});
