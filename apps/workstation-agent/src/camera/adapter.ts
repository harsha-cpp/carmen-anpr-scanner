import { spawn, type ChildProcess } from "node:child_process";
import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import type { CameraFrame, ComponentHealth, WorkstationConfig } from "../types.js";

type CameraAdapterConfig = Pick<WorkstationConfig, "cameraSource" | "cameraFps">;
type FrameHandler = (frame: CameraFrame) => void | Promise<void>;

const logger = createLogger("camera-adapter");

function isRtspSource(source: string): boolean {
  return source.startsWith("rtsp://") || source.startsWith("rtsps://");
}

function ffmpegArgs(source: string): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    ...(isRtspSource(source) ? ["-rtsp_transport", "tcp"] : []),
    "-i",
    source,
    "-an",
    "-frames:v",
    "1",
    "-f",
    "image2pipe",
    "-vcodec",
    "mjpeg",
    "pipe:1",
  ];
}

export class CameraAdapter {
  private readonly config: CameraAdapterConfig;
  private timer: NodeJS.Timeout | null = null;
  private currentProcess: ChildProcess | null = null;
  private capturing = false;
  private started = false;
  private connected = false;
  private lastFrameAt: Date | null = null;
  private lastError: string | null = null;

  public constructor(config: CameraAdapterConfig = loadConfig()) {
    this.config = config;
  }

  public async start(onFrame?: FrameHandler): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (!onFrame) {
      logger.info("camera adapter started in pull mode", { source: this.config.cameraSource });
      return;
    }
    const intervalMs = Math.max(100, Math.round(1000 / Math.max(this.config.cameraFps, 1)));
    await this.tick(onFrame);
    this.timer = setInterval(() => {
      void this.tick(onFrame);
    }, intervalMs);
    logger.info("camera adapter started", { source: this.config.cameraSource, fps: this.config.cameraFps });
  }

  public async stop(): Promise<void> {
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.currentProcess && !this.currentProcess.killed) this.currentProcess.kill("SIGKILL");
    this.currentProcess = null;
    this.capturing = false;
    this.connected = false;
    logger.info("camera adapter stopped", { source: this.config.cameraSource });
  }

  public async captureFrame(): Promise<CameraFrame> {
    return this.grabFrame();
  }

  public async grabFrame(): Promise<CameraFrame> {
    return new Promise((resolve, reject) => {
      const child = spawn("ffmpeg", ffmpegArgs(this.config.cameraSource), { stdio: ["ignore", "pipe", "pipe"] });
      this.currentProcess = child;
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      const timeout = setTimeout(() => child.kill("SIGKILL"), 15_000);

      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.once("error", (error) => {
        clearTimeout(timeout);
        this.currentProcess = null;
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        this.currentProcess = null;
        if (code !== 0 || stdout.length === 0) {
          reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `ffmpeg exited with code ${code ?? -1}`));
          return;
        }
        resolve({ data: Buffer.concat(stdout), timestamp: new Date(), source: this.config.cameraSource });
      });
    });
  }

  public async healthCheck(): Promise<ComponentHealth> {
    const now = new Date();
    const staleMs = Math.max(5_000, Math.round(3000 / Math.max(this.config.cameraFps, 1)));
    const isFresh = this.lastFrameAt !== null && now.getTime() - this.lastFrameAt.getTime() <= staleMs;
    const status = !this.started ? "degraded" : this.connected && isFresh ? "healthy" : "unhealthy";
    const message = !this.started
      ? "camera adapter is stopped"
      : this.connected && isFresh
        ? "camera frames are flowing"
        : this.lastError ?? "camera capture is stale";
    return { component: "camera", status, message, lastCheckedAt: now.toISOString() };
  }

  private async tick(onFrame: FrameHandler): Promise<void> {
    if (!this.started || this.capturing) return;
    this.capturing = true;
    try {
      const frame = await this.captureFrame();
      this.connected = true;
      this.lastError = null;
      this.lastFrameAt = frame.timestamp;
      await onFrame(frame);
    } catch (error) {
      this.connected = false;
      this.lastError = error instanceof Error ? error.message : "camera capture failed";
      logger.error("camera capture failed", { source: this.config.cameraSource, error: this.lastError });
    } finally {
      this.capturing = false;
    }
  }
}

export { CameraAdapter as FfmpegCameraAdapter };

export function createCameraAdapter(config: CameraAdapterConfig = loadConfig()): CameraAdapter {
  return new CameraAdapter(config);
}
