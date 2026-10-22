import { describe, expect, it } from "vitest";
import {
  buildGapContextNote,
  formatDateDivider,
  formatMessageTime,
  formatTimeGap,
  injectGapContextIntoText,
  shouldShowDateDivider,
} from "./timestamps";

describe("timestamps, date dividers, and gap awareness", () => {
  it("formats message time and detects Today, Yesterday, and older dates", () => {
    const now = new Date(2026, 9, 21, 14, 5, 0).getTime();
    const yesterday = new Date(2026, 9, 20, 9, 30, 0).getTime();
    const older = new Date(2026, 9, 12, 18, 0, 0).getTime();

    expect(formatMessageTime(now)).toBe("14:05");
    expect(formatDateDivider(now, now)).toBe("Today");
    expect(formatDateDivider(yesterday, now)).toBe("Yesterday");
    expect(formatDateDivider(older, now)).toBe("Oct 12, 2026");

    expect(shouldShowDateDivider(undefined, now)).toBe(true);
    expect(shouldShowDateDivider(yesterday, now)).toBe(true);
    expect(shouldShowDateDivider(now - 60_000, now)).toBe(false);
  });

  it("computes human-readable time gaps and injects [Context: ... since previous message] when >= 1 hour", () => {
    const t0 = new Date(2026, 9, 21, 8, 0, 0).getTime();
    const tShort = t0 + 20 * 60_000;
    const tLong = t0 + (6 * 60 + 20) * 60_000;

    expect(formatTimeGap(t0, tShort)).toBeNull();
    expect(buildGapContextNote(t0, tShort)).toBeNull();

    expect(formatTimeGap(t0, tLong)).toBe("6h 20m later");
    const note = buildGapContextNote(t0, tLong);
    expect(note).toBe("[Context: 6h 20m since previous message; local time 2026-10-21 14:20]");

    const injected = injectGapContextIntoText("Check the server logs", t0, tLong, true);
    expect(injected).toContain("[Context: 6h 20m since previous message;");
    expect(injected).toContain("Check the server logs");
  });
});
