import { describe, expect, it } from "vitest";
import {
  formatSessionJson,
  formatSessionMarkdown,
  messageMatchesQuery,
  safeExportFilename,
} from "./export";
import type { HermesMessage } from "./types";

const sampleMessages: HermesMessage[] = [
  {
    id: "m1",
    role: "user",
    text: "Check docker status on my headless PC",
    createdAt: 1700000000000,
  },
  {
    id: "m2",
    role: "assistant",
    text: "All 4 containers are healthy.",
    reasoning: "Running docker ps to inspect containers.",
    tools: [
      {
        id: "t1",
        name: "bash",
        input: { command: "docker ps" },
        rawInput: '{"command":"docker ps"}',
        output: "CONTAINER ID ...",
        state: "output-available",
      },
    ],
    createdAt: 1700000005000,
    model: "claude-3-7-sonnet",
  },
];

describe("session export & search", () => {
  it("formats markdown with session metadata, reasoning, and tool calls", () => {
    const md = formatSessionMarkdown(sampleMessages, {
      sessionId: "sess_1",
      title: "Docker Health Check",
      profile: "default",
      model: "claude-3-7-sonnet",
      exportedAt: "2026-10-19T00:00:00.000Z",
    });

    expect(md).toContain("# Docker Health Check");
    expect(md).toContain("`sess_1`");
    expect(md).toContain("Check docker status on my headless PC");
    expect(md).toContain("Tool `bash`");
    expect(md).toContain("All 4 containers are healthy.");
  });

  it("formats structured JSON without data URL payloads", () => {
    const raw = formatSessionJson(sampleMessages, {
      sessionId: "sess_1",
      title: "Docker Health Check",
      exportedAt: "2026-10-19T00:00:00.000Z",
    });
    const parsed = JSON.parse(raw);
    expect(parsed.sessionId).toBe("sess_1");
    expect(parsed.messageCount).toBe(2);
    expect(parsed.messages[1].tools[0].name).toBe("bash");
  });

  it("matches messages by text, reasoning, or tool call content", () => {
    expect(messageMatchesQuery(sampleMessages[0]!, "headless")).toBe(true);
    expect(messageMatchesQuery(sampleMessages[1]!, "docker ps")).toBe(true);
    expect(messageMatchesQuery(sampleMessages[1]!, "nonexistent")).toBe(false);
  });

  it("produces clean export filenames", () => {
    expect(safeExportFilename("Docker Health Check!", "md")).toBe("docker-health-check.md");
    expect(safeExportFilename("", "json")).toBe("hermes-session.json");
  });
});
