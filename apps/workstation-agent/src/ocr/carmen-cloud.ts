import { createLogger } from "../logger.js";
import type { OcrProvider, OcrResult, WorkstationConfig } from "../types.js";

const logger = createLogger("carmen-cloud-ocr");

interface CarmenCloudConfig {
  apiKey: string;
  apiBase: string;
  region: string;
  timeoutMs: number;
  maxConcurrent: number;
}

interface CarmenVehicle {
  plate?: {
    found?: boolean;
    unicodeText?: string;
    plateText?: string;
    text?: string;
    country?: string;
    confidence?: number;
  };
  mmr?: {
    make?: string;
    model?: string;
    color?: string;
    colorName?: string;
    category?: string;
  };
}

interface CarmenApiResponse {
  data?: { vehicles?: CarmenVehicle[] };
  vehicles?: CarmenVehicle[];
}

export class CarmenCloudOcrAdapter implements OcrProvider {
  public readonly name = "carmen-cloud";
  private readonly config: CarmenCloudConfig;
  private ready = false;
  private lastError: string | null = null;
  private activeRequests = 0;

  public constructor(wsConfig: WorkstationConfig) {
    this.config = {
      apiKey: wsConfig.carmenApiKey,
      apiBase: wsConfig.carmenCloudApiBase || "https://ap-southeast-1.api.carmencloud.com/vehicle",
      region: wsConfig.carmenRegion || "IND",
      timeoutMs: wsConfig.carmenCloudTimeoutMs || 10_000,
      maxConcurrent: wsConfig.carmenCloudMaxConcurrent || 3,
    };
  }

  public async initialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new Error("CARMEN_API_KEY is required for carmen-cloud OCR provider");
    }
    this.ready = true;
    logger.info("carmen cloud ocr initialized", {
      region: this.config.region,
      apiBase: this.config.apiBase,
    });
  }

  public async recognize(imageBuffer: Buffer): Promise<OcrResult[]> {
    if (!this.ready) await this.initialize();

    if (this.activeRequests >= this.config.maxConcurrent) {
      logger.debug("carmen cloud skipping frame, max concurrent reached", { active: this.activeRequests });
      return [];
    }

    this.activeRequests++;
    try {
      logger.debug("carmen cloud sending frame", { size: imageBuffer.length, active: this.activeRequests });
      const vehicles = await this.callApi(imageBuffer);
      this.lastError = null;
      const results = this.parseVehicles(vehicles);
      logger.debug("carmen cloud response", { vehicleCount: vehicles.length, plateCount: results.length });
      return results;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "carmen cloud request failed";
      logger.error("carmen cloud recognition failed", { error: this.lastError });
      throw error;
    } finally {
      this.activeRequests--;
    }
  }

  public async shutdown(): Promise<void> {
    this.ready = false;
    logger.info("carmen cloud ocr shutdown");
  }

  public async healthCheck(): Promise<{ ok: boolean; message: string }> {
    if (!this.ready) {
      return { ok: false, message: this.lastError ?? "carmen cloud ocr not initialized" };
    }
    return {
      ok: true,
      message: `carmen cloud ocr ready (region=${this.config.region}, active=${this.activeRequests})`,
    };
  }

  private async callApi(jpegBuffer: Buffer): Promise<CarmenVehicle[]> {
    const form = new FormData();
    const arrayBuf = jpegBuffer.buffer.slice(jpegBuffer.byteOffset, jpegBuffer.byteOffset + jpegBuffer.byteLength) as ArrayBuffer;
    const blob = new Blob([arrayBuf], { type: "image/jpeg" });
    form.append("image", blob, "frame.jpg");
    form.append("service", "anpr,mmr");

    const url = `${this.config.apiBase}/${this.config.region.toLowerCase()}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "X-Api-Key": this.config.apiKey },
      body: form,
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Carmen Cloud API ${resp.status}: ${body.slice(0, 200)}`);
    }

    const json = await resp.json() as CarmenApiResponse;
    return json?.data?.vehicles ?? json?.vehicles ?? [];
  }

  private parseVehicles(vehicles: CarmenVehicle[]): OcrResult[] {
    const results: OcrResult[] = [];
    for (const v of vehicles) {
      const plate = v.plate;
      if (!plate?.found || !plate?.unicodeText) continue;

      results.push({
        plate: plate.unicodeText,
        confidence: (plate.confidence ?? 0) / 100,
        country: plate.country ?? "",
        make: v.mmr?.make ?? "",
        model: v.mmr?.model ?? "",
        color: v.mmr?.colorName ?? v.mmr?.color ?? "",
        category: v.mmr?.category ?? "",
      });
    }
    return results;
  }
}
