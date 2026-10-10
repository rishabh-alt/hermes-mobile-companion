import { describe, expect, it } from "vitest";
import { toHermesMessage, toolSummary } from "./transcript";

describe("tool transcript", () => {
  it("does not show a file read as the chat reply", () => {
    const message = toHermesMessage(
      {
        role: "tool",
        tool_name: "read_file",
        content: '{"content": "56| if (value === \\"api_server\\")\\n57| return true"}',
      },
      0,
    );
    expect(message.text).toBe("");
    expect(message.tools?.[0]?.output).toBe("read_file read a file");
  });

  it("keeps a terminal result to one line", () => {
    expect(toolSummary("terminal", '{"output": "7 passed in 0.53s\\n"}')).toBe("7 passed in 0.53s");
  });
});
