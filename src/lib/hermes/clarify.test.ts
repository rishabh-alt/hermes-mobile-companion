import { describe, expect, it } from "vitest";
import { parseClarify } from "./clarify";

describe("parseClarify", () => {
  it("reads a question from a tool start and ignores a file dump", () => {
    expect(
      parseClarify({
        tool_name: "clarify",
        tool_call_id: "call-1",
        args: { question: "Which file?", choices: ["a", "b"] },
      }),
    ).toEqual({ id: "call-1", question: "Which file?", choices: ["a", "b"] });
    expect(parseClarify({ preview: "56| if (value" })).toBeNull();
  });
});
