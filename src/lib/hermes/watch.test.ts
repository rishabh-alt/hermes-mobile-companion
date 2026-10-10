import { describe, expect, it } from "vitest";
import { parseWatchFrame } from "./watch";

describe("parseWatchFrame", () => {
  it("reads a named host event without treating a ready frame as a new message", () => {
    expect(parseWatchFrame('event: watch.ready\ndata: {"session_id":"s1"}\n\n')).toEqual({
      event: "watch.ready",
      payload: { session_id: "s1" },
    });
    expect(
      parseWatchFrame(
        'event: message.added\ndata: {"id":"2","role":"assistant","content":"hello"}\n\n',
      )?.event,
    ).toBe("message.added");
  });
});
