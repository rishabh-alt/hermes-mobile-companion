import { describe, expect, it } from "vitest";
import { clearDebugLog, debugLines, note, redact } from "./debug-log";

describe("debug log", () => {
  it("does not keep a token that was passed in a note", () => {
    clearDebugLog();
    note("probe failed bearer abcdefghijklmnopqrstuvwxyz012345");
    expect(redact("bearer secret-token-value-that-is-long")).not.toContain("secret-token");
    expect(debugLines().join("\n")).not.toContain("abcdefghijklmnopqrstuvwxyz012345");
    expect(debugLines()[0]).toContain("bearer [redacted]");
  });
});
