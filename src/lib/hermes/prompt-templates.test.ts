import { beforeEach, describe, expect, it } from "vitest";
import {
  addCustomPromptTemplate,
  BUILTIN_PROMPT_TEMPLATES,
  getAllPromptTemplates,
  readCustomPromptTemplates,
  removeCustomPromptTemplate,
} from "./prompt-templates";

const store = new Map<string, string>();

describe("prompt templates", () => {
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

  it("includes built-in headless operator templates by default", () => {
    const all = getAllPromptTemplates();
    expect(all.length).toBeGreaterThanOrEqual(BUILTIN_PROMPT_TEMPLATES.length);
    expect(all.some((t) => t.id === "builtin_host_health")).toBe(true);
  });

  it("adds and removes custom templates in localStorage", () => {
    const afterAdd = addCustomPromptTemplate("Restart Ollama", "sudo systemctl restart ollama");
    expect(afterAdd).toHaveLength(1);
    expect(afterAdd[0]?.title).toBe("Restart Ollama");
    expect(afterAdd[0]?.custom).toBe(true);

    const id = afterAdd[0]!.id;
    expect(readCustomPromptTemplates()).toHaveLength(1);

    const afterRemove = removeCustomPromptTemplate(id);
    expect(afterRemove).toHaveLength(0);
  });
});
