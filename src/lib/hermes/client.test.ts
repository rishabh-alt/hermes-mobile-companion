import { describe, expect, it } from "vitest";
import { parseSecureBaseUrl } from "./client";

describe("parseSecureBaseUrl", () => {
  it.each([
    ["https://example.com", "https://example.com"],
    ["HTTPS://example.com/", "https://example.com"],
    ["  https://example.com/base///  ", "https://example.com/base"],
  ])("accepts and normalizes secure gateway URLs", (input, expected) => {
    expect(parseSecureBaseUrl(input)).toBe(expected);
  });

  it.each([
    "",
    "https://",
    "http://example.com",
    "https://user:secret@example.com",
    "https://example.com?token=secret",
    "https://example.com/#fragment",
  ])("rejects unsafe or malformed gateway URL %s", (input) => {
    expect(parseSecureBaseUrl(input)).toBeNull();
  });
});
