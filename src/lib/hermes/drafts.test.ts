import { beforeEach, describe, expect, it } from "vitest";
import { clearSessionDraft, getSessionDraft, setSessionDraft } from "./drafts";

const store = new Map<string, string>();

describe("session drafts", () => {
  beforeEach(() => {
    store.clear();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => store.get(key) ?? null,
          setItem: (key: string, value: string) => store.set(key, value),
          removeItem: (key: string) => store.delete(key),
        },
      },
    });
  });

  it("stores and retrieves drafts per profile and session", () => {
    expect(getSessionDraft("default", "s1")).toBe("");
    setSessionDraft("default", "s1", "check docker logs");
    setSessionDraft("ops", "s1", "restart gateway");

    expect(getSessionDraft("default", "s1")).toBe("check docker logs");
    expect(getSessionDraft("ops", "s1")).toBe("restart gateway");
  });

  it("clears a session draft when empty or explicitly cleared", () => {
    setSessionDraft("default", "s2", "draft text");
    expect(getSessionDraft("default", "s2")).toBe("draft text");

    clearSessionDraft("default", "s2");
    expect(getSessionDraft("default", "s2")).toBe("");
  });
});
