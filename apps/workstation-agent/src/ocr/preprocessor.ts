import sharp from "sharp";

/**
 * Preprocesses an image buffer for OCR: converts to grayscale, normalizes
 * contrast, sharpens edges, and thresholds to binary. Results in clean
 * black-on-white text for Tesseract.
 */
export async function preprocessForOcr(imageBuffer: Buffer): Promise<Buffer> {
  return sharp(imageBuffer)
    .grayscale()
    .normalize()
    .sharpen()
    .threshold(128)
    .jpeg({ quality: 95 })
    .toBuffer();
}
