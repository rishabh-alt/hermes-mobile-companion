import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("stream transport split", () => {
  it("does not patch fetch, and chat does not call native HTTP", () => {
    const config = readFileSync("capacitor.config.ts", "utf8");
    const chat = readFileSync("src/lib/hermes/session-api.ts", "utf8");
    const watch = readFileSync("src/lib/hermes/watch.ts", "utf8");
    const probe = readFileSync("src/routes/settings.tsx", "utf8");
    expect(config).toContain("enabled: false");
    expect(chat).not.toContain("CapacitorHttp");
    expect(watch).not.toContain("CapacitorHttp");
    expect(probe).toContain("nativeGet");
  });
});
