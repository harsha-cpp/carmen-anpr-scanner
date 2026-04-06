import { createScheduler, createWorker, OEM, PSM, type Scheduler, type Worker } from "tesseract.js";
import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import type { OcrProvider, OcrResult, WorkstationConfig } from "../types.js";
import { preprocessForOcr } from "./preprocessor.js";

type OcrAdapterConfig = Pick<WorkstationConfig, "ocrLang" | "ocrPreprocess" | "ocrMinConfidence" | "ocrWorkerCount">;

const logger = createLogger("ocr-adapter");

function normalizePlate(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

export class TesseractOcrAdapter implements OcrProvider {
  public readonly name = "tesseract";
  private readonly language: string;
  private readonly config: OcrAdapterConfig;
  private scheduler: Scheduler | null = null;
  private worker: Worker | null = null;
  private workers: Worker[] = [];
  private ready = false;
  private lastError: string | null = null;

  public constructor(config: OcrAdapterConfig = loadConfig()) {
    this.config = config;
    this.language = config.ocrLang;
  }

  public async initialize(): Promise<void> {
    if (this.ready) return;
    this.scheduler = createScheduler();
    for (let i = 0; i < this.config.ocrWorkerCount; i++) {
      const w = await createWorker(this.language);
      await w.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
        tessedit_ocr_engine_mode: OEM.LSTM_ONLY,
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      });
      this.scheduler.addWorker(w);
      this.workers.push(w);
    }
    this.worker = this.workers[0] ?? null;
    this.ready = true;
    this.lastError = null;
    logger.info("ocr adapter initialized", { provider: this.name, language: this.language, workerCount: this.workers.length });
  }

  public async recognize(imageBuffer: Buffer): Promise<OcrResult[]> {
    if (!this.scheduler) await this.initialize();
    const processedBuffer = this.config.ocrPreprocess
      ? await preprocessForOcr(imageBuffer)
      : imageBuffer;
    try {
      const result = await this.scheduler!.addJob("recognize", processedBuffer);
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
        if (!item.plate || item.confidence < this.config.ocrMinConfidence) continue;
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
    this.workers = [];
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
