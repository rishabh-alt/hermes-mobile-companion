import { describe, expect, it } from "vitest";
import { sessionLabel } from "./session-title";

describe("sessionLabel", () => {
  it("uses the first message when the host has no title", () => {
    expect(
      sessionLabel({
        id: "20261005_093334_91d38b",
        preview: "got 18$ qwen studio sub for you",
      }),
    ).toBe("got 18$ qwen studio sub for you");
  });

  it("does not leave a pulled chat named Session", () => {
    expect(
      sessionLabel({
        title: "Session",
        messages: [{ role: "user", text: "okay i can work on the app now" }],
      }),
    ).toBe("okay i can work on the app now");
  });
});
