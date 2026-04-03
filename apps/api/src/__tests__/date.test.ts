import { describe, expect, it } from "vitest";
import { parseOptionalDateInput } from "../utils/date.js";

describe("parseOptionalDateInput", () => {
  it("returns null for missing values", () => {
    expect(parseOptionalDateInput(undefined)).toBeNull();
    expect(parseOptionalDateInput(null)).toBeNull();
    expect(parseOptionalDateInput("   ")).toBeNull();
  });

  it("returns undefined for invalid values", () => {
    expect(parseOptionalDateInput(123)).toBeUndefined();
    expect(parseOptionalDateInput("not-a-date")).toBeUndefined();
  });

  it("parses valid ISO date strings", () => {
    const parsed = parseOptionalDateInput("2026-04-02T12:34:56.000Z");
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed?.toISOString()).toBe("2026-04-02T12:34:56.000Z");
  });
});
