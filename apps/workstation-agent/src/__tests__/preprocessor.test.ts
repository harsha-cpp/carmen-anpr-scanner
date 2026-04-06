import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { preprocessForOcr } from "../ocr/preprocessor.js";

describe("preprocessForOcr", () => {
  it("returns a valid JPEG buffer", async () => {
    const testImage = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .jpeg()
      .toBuffer();

    const result = await preprocessForOcr(testImage);

    expect(result[0]).toBe(0xff);
    expect(result[1]).toBe(0xd8);
    expect(result.length).toBeGreaterThan(0);
  });

  it("processes a non-white image without throwing", async () => {
    const testImage = await sharp({
      create: { width: 5, height: 5, channels: 3, background: { r: 128, g: 128, b: 128 } },
    })
      .jpeg()
      .toBuffer();

    const result = await preprocessForOcr(testImage);

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result[0]).toBe(0xff);
    expect(result[1]).toBe(0xd8);
  });
});
