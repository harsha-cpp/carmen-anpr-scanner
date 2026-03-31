import { createScheduler, createWorker, type Scheduler, type Worker } from "tesseract.js";
import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import type { OcrProvider, OcrResult, WorkstationConfig } from "../types.js";

type OcrAdapterConfig = Pick<WorkstationConfig, "ocrLang">;

const logger = createLogger("ocr-adapter");
const MIN_CONFIDENCE = 0.4;

function normalizePlate(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

export class TesseractOcrAdapter implements OcrProvider {
  public readonly name = "tesseract";
  private readonly language: string;
  private scheduler: Scheduler | null = null;
  private worker: Worker | null = null;
  private ready = false;
  private lastError: string | null = null;

  public constructor(config: OcrAdapterConfig = loadConfig()) {
    this.language = config.ocrLang;
  }

  public async initialize(): Promise<void> {
    if (this.ready) return;
    this.scheduler = createScheduler();
    this.worker = await createWorker(this.language);
    this.scheduler.addWorker(this.worker);
    this.ready = true;
    this.lastError = null;
    logger.info("ocr adapter initialized", { provider: this.name, language: this.language });
  }

  public async recognize(imageBuffer: Buffer): Promise<OcrResult[]> {
    if (!this.scheduler) await this.initialize();
    try {
      const result = await this.scheduler!.addJob("recognize", imageBuffer);
      const lines = result.data.lines.map((line) => ({
        plate: normalizePlate(line.text),
        confidence: line.confidence / 100,
      }));
      const fallback = {
        plate: normalizePlate(result.data.text),
        confidence: result.data.confidence / 100,
      };
      const unique = new Map<string, OcrResult>();
      for (const item of [...lines, fallback]) {
        if (!item.plate || item.confidence < MIN_CONFIDENCE) continue;
        const current = unique.get(item.plate);
        if (!current || item.confidence > current.confidence) unique.set(item.plate, item);
      }
      this.lastError = null;
      return [...unique.values()].sort((left, right) => right.confidence - left.confidence);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "ocr recognition failed";
      logger.error("ocr recognition failed", { provider: this.name, error: this.lastError });
      throw error;
    }
  }

  public async shutdown(): Promise<void> {
    if (this.scheduler) await this.scheduler.terminate();
    this.scheduler = null;
    this.worker = null;
    this.ready = false;
    logger.info("ocr adapter shutdown", { provider: this.name });
  }

  public async terminate(): Promise<void> {
    await this.shutdown();
  }

  public async healthCheck(): Promise<{ ok: boolean; message: string }> {
    return this.ready
      ? { ok: true, message: `ocr worker ready for ${this.language}` }
      : { ok: false, message: this.lastError ?? "ocr worker not initialized" };
  }
}

export { TesseractOcrAdapter as TesseractOcrProvider };

export function createOcrAdapter(config: OcrAdapterConfig = loadConfig()): TesseractOcrAdapter {
  return new TesseractOcrAdapter(config);
}
