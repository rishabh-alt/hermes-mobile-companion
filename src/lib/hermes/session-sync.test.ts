import { describe, expect, it } from "vitest";
import { mergePulledMessages } from "./session-sync";
import type { HermesMessage } from "./types";

function message(role: HermesMessage["role"], text: string): HermesMessage {
  return { id: text, role, text, createdAt: 1 };
}

describe("mergePulledMessages", () => {
  it("keeps the turn on screen when the host page is behind", () => {
    const local = [message("user", "it shows me you replied"), message("assistant", "The refresh deleted it.")];
    const pulled = [message("user", "older")];
    expect(mergePulledMessages(local, pulled)).toBe(local);
  });

  it("keeps a reply the host page has not stored yet", () => {
    const local = [message("user", "it shows me you replied"), message("assistant", "The refresh deleted it.")];
    const pulled = [message("user", "it shows me you replied")];
    expect(mergePulledMessages(local, pulled)).toBe(local);
  });

  it("uses the host page once it contains that turn", () => {
    const local = [message("user", "it shows me you replied")];
    const pulled = [
      message("user", "it shows me you replied"),
      message("assistant", "The refresh deleted it."),
    ];
    expect(mergePulledMessages(local, pulled)).toBe(pulled);
  });
});
