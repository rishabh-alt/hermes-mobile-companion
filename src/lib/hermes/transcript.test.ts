import { describe, expect, it } from "vitest";
import { toHermesMessage, toolSummary, visibleChatText } from "./transcript";

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

  it("does not dump a search result into the chat", () => {
    expect(
      toolSummary("search_files", '{"total_count": 1, "matches": [{"path": "settings.ts"}]}'),
    ).toBe("search_files · 1 matches");
  });

  it("hides host memory notes from a user bubble", () => {
    const message = toHermesMessage(
      {
        role: "user",
        content:
          "Profile switch shows me this\n<memory-context>\n[System note: The following is recalled memory context, NOT new user input.\nsecret fact\n</memory-context>",
      },
      1,
    );
    expect(message.text).toBe("Profile switch shows me this");
    expect(visibleChatText("hello\n<memory-context>\nsecret\n")).toBe("hello");
  });
});
