import { describe, expect, it } from "vitest";
import { normalizePlate } from "../utils/plate.js";

describe("normalizePlate", () => {
  it("normalizes mixed-case formatted plates", () => {
    expect(normalizePlate("ap-39 bk 2015")).toBe("AP39BK2015");
  });

  it("removes unsupported characters", () => {
    expect(normalizePlate("  mh@12#aa-0001 ")).toBe("MH12AA0001");
  });
});
