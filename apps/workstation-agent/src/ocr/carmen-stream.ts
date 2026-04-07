import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { createLogger } from "../logger.js";
import type { ComponentHealth, WorkstationConfig } from "../types.js";

const logger = createLogger("carmen-stream");

const RESTART_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];
const SEPARATOR_LINE = "------------------------------------------------------";

export interface CarmenDetection {
  plate: string;
  country: string;
  make: string;
  model: string;
  color: string;
  category: string;
  timestamp: number;
}

type DetectionHandler = (detection: CarmenDetection) => void;

interface CarmenStreamConfig {
  carmenBinaryPath: string;
  carmenApiKey: string;
  carmenRegion: string;
  cameraSource: string;
}

export class CarmenStreamAdapter {
  private readonly config: CarmenStreamConfig;
  private process: ChildProcess | null = null;
  private started = false;
  private connected = false;
  private lastDetectionAt: Date | null = null;
  private lastError: string | null = null;
  private processRestarts = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private detectionHandler: DetectionHandler | null = null;
  private lineBuffer = "";
  private pendingDetection: Partial<CarmenDetection> | null = null;
  private detectionCount = 0;
  private lastStatusMessage = "";

  public constructor(config: WorkstationConfig) {
    this.config = {
      carmenBinaryPath: config.carmenBinaryPath
        || resolve(process.cwd(), "../../sdk_samples/samples/C++/build/05_cloud/cpp_sample_05_cloud"),
      carmenApiKey: config.carmenApiKey || "",
      carmenRegion: config.carmenRegion || "IND",
      cameraSource: config.cameraSource,
    };
  }

  public async start(onDetection: DetectionHandler): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.detectionHandler = onDetection;
    this.spawnProcess(0);
    logger.info("carmen stream adapter started", {
      region: this.config.carmenRegion,
      source: this.config.cameraSource,
      binary: this.config.carmenBinaryPath,
    });
  }

  public async stop(): Promise<void> {
    this.started = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;

    if (this.process && !this.process.killed) {
      try {
        this.process.stdin?.write("q\n");
      } catch {
        // ignored: stdin may already be closed
      }
      const proc = this.process;
      const killTimer = setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL");
      }, 3000);
      proc.once("close", () => clearTimeout(killTimer));
    }

    this.process = null;
    this.connected = false;
    logger.info("carmen stream adapter stopped");
  }

  public async healthCheck(): Promise<ComponentHealth> {
    const now = new Date();
    const staleThresholdMs = 15_000;
    const isFresh = this.lastDetectionAt !== null
      && now.getTime() - this.lastDetectionAt.getTime() <= staleThresholdMs;

    let status: ComponentHealth["status"];
    let message: string;

    if (!this.started) {
      status = "degraded";
      message = "carmen stream adapter is stopped";
    } else if (this.connected && isFresh) {
      status = "healthy";
      message = `carmen stream processing (${this.detectionCount} detections, region=${this.config.carmenRegion})`;
    } else if (this.connected) {
      status = "healthy";
      message = this.lastStatusMessage || "carmen stream connected, awaiting detections";
    } else {
      status = "unhealthy";
      message = this.lastError ?? "carmen stream not connected";
    }

    return { component: "carmen-anpr", status, message, lastCheckedAt: now.toISOString() };
  }

  private formatSource(source: string): string {
    // Carmen Video SDK expects file sources prefixed with "file:"
    if (source.startsWith("rtsp://") || source.startsWith("rtsps://") || source.startsWith("http://") || source.startsWith("https://")) {
      return source;
    }
    // Resolve relative paths and prefix with file:
    const absPath = resolve(process.cwd(), source);
    return `file:${absPath}`;
  }

  private spawnProcess(restartCount: number): void {
    if (!this.started) return;

    const source = this.formatSource(this.config.cameraSource);
    const args = [this.config.carmenRegion, source, this.config.carmenApiKey];

    logger.debug("spawning carmen binary", {
      binary: this.config.carmenBinaryPath,
      region: this.config.carmenRegion,
      source,
    });

    const child = spawn(this.config.carmenBinaryPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        LD_LIBRARY_PATH: [
          "/usr/lib/carmen_video_sdk",
          process.env.LD_LIBRARY_PATH || "",
        ].filter(Boolean).join(":"),
      },
    });

    this.process = child;
    this.lineBuffer = "";
    this.pendingDetection = null;

    child.stdout.on("data", (chunk: Buffer) => {
      this.handleStdout(chunk.toString("utf-8"));
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const msg = chunk.toString("utf-8").trim();
      if (msg) {
        logger.debug("carmen stderr", { msg: msg.slice(0, 200) });
      }
    });

    child.once("error", (err) => {
      this.lastError = err.message;
      this.connected = false;
      logger.error("carmen process error", { error: err.message });
    });

    child.once("close", (code) => {
      if (!this.started) return;
      this.process = null;
      this.connected = false;
      this.processRestarts += 1;
      const backoff = RESTART_BACKOFF_MS[Math.min(restartCount, RESTART_BACKOFF_MS.length - 1)];
      logger.warn("carmen process exited, restarting", { code, restarts: this.processRestarts, backoffMs: backoff });
      this.restartTimer = setTimeout(() => this.spawnProcess(restartCount + 1), backoff);
    });
  }

  private handleStdout(data: string): void {
    this.lineBuffer += data;
    const lines = this.lineBuffer.split("\n");
    // Keep the last incomplete line in the buffer
    this.lineBuffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      this.parseLine(rawLine.trim());
    }
  }

  private parseLine(line: string): void {
    if (!line) return;

    // Status change detection
    if (line.includes("status changed")) {
      this.lastStatusMessage = line;
      if (line.includes('"Running"')) {
        this.connected = true;
        this.lastError = null;
        logger.info("carmen stream is running");
      } else if (line.includes('"Finished"') || line.includes('"Failure"')) {
        this.connected = false;
        if (line.includes('"Failure"')) {
          this.lastError = "carmen stream processor reported failure";
          logger.error("carmen stream failure", { status: line });
        }
      }
      return;
    }

    // Separator starts a new detection block
    if (line === SEPARATOR_LINE) {
      this.flushPendingDetection();
      this.pendingDetection = {};
      return;
    }

    // Parse detection fields
    if (this.pendingDetection === null) return;

    if (line.startsWith("Plate text:")) {
      this.pendingDetection.plate = line.slice("Plate text:".length).trim();
    } else if (line.startsWith("Country:")) {
      this.pendingDetection.country = line.slice("Country:".length).trim();
    } else if (line.startsWith("Make:")) {
      this.pendingDetection.make = line.slice("Make:".length).trim();
    } else if (line.startsWith("Model:")) {
      this.pendingDetection.model = line.slice("Model:".length).trim();
    } else if (line.startsWith("Color:")) {
      this.pendingDetection.color = line.slice("Color:".length).trim();
    } else if (line.startsWith("Category:")) {
      this.pendingDetection.category = line.slice("Category:".length).trim();
    } else if (line.startsWith("Unix timestamp:")) {
      const raw = line.slice("Unix timestamp:".length).trim().replace(/\s*ms$/, "");
      const ts = parseInt(raw, 10);
      if (!Number.isNaN(ts)) {
        this.pendingDetection.timestamp = ts;
      }
    }
  }

  private flushPendingDetection(): void {
    if (!this.pendingDetection) return;
    const det = this.pendingDetection;
    this.pendingDetection = null;

    // Must have at least a plate to be a valid detection
    if (!det.plate || !det.plate.trim()) return;

    const detection: CarmenDetection = {
      plate: det.plate.trim(),
      country: det.country?.trim() ?? "",
      make: det.make?.trim() ?? "",
      model: det.model?.trim() ?? "",
      color: det.color?.trim() ?? "",
      category: det.category?.trim() ?? "",
      timestamp: det.timestamp ?? Date.now(),
    };

    this.detectionCount++;
    this.lastDetectionAt = new Date();
    this.lastError = null;

    logger.debug("carmen detection", {
      plate: detection.plate,
      country: detection.country,
      count: this.detectionCount,
    });

    if (this.detectionHandler) {
      try {
        this.detectionHandler(detection);
      } catch (err) {
        logger.error("detection handler error", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
