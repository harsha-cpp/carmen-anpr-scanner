import { spawn, type ChildProcess } from "node:child_process";
import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import type { CameraFrame, ComponentHealth, WorkstationConfig } from "../types.js";

type CameraAdapterConfig = Pick<WorkstationConfig, "cameraSource" | "cameraFps" | "rtspTransport" | "rtspConnectTimeoutMs" | "rtspReadTimeoutMs" | "rtspReconnectMaxAttemptsPerSession" | "rtspStreamValidationIntervalMs">;
type FrameHandler = (frame: CameraFrame) => void | Promise<void>;

const logger = createLogger("camera-adapter");

interface RtspStreamStats {
  connectionAttempts: number;
  lastConnectionError: string | null;
  bytesReceived: number;
  framesCaptured: number;
  lastValidFrameAt: Date | null;
}

function isRtspSource(source: string): boolean {
  return source.startsWith("rtsp://") || source.startsWith("rtsps://");
}

function buildFfmpegArgs(source: string, config: CameraAdapterConfig): string[] {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
  ];

  // RTSP-specific options
  if (isRtspSource(source)) {
    // Transport protocol
    args.push("-rtsp_transport", config.rtspTransport);
    
    // Connection and read timeouts (in seconds, converted from ms)
    const connectTimeoutS = Math.max(1, Math.floor(config.rtspConnectTimeoutMs / 1000));
    const readTimeoutS = Math.max(1, Math.floor(config.rtspReadTimeoutMs / 1000));
    
    args.push(
      "-connect_timeout", String(connectTimeoutS * 1_000_000), // microseconds
      "-read_timeout", String(readTimeoutS * 1_000_000), // microseconds
    );
    
    // Additional RTSP options
    args.push(
      "-stimeout", String(readTimeoutS * 1_000_000), // stream timeout in microseconds
      "-fflags", "nobuffer", // minimize buffering for lower latency
      "-flags", "low_delay", // low delay mode
    );
  }

  // Common arguments for frame capture
  args.push(
    "-i", source,
    "-an", // no audio
    "-frames:v", "1", // single frame
    "-f", "image2pipe",
    "-vcodec", "mjpeg",
    "pipe:1",
  );

  return args;
}

export class CameraAdapter {
  private readonly config: CameraAdapterConfig;
  private timer: NodeJS.Timeout | null = null;
  private validationTimer: NodeJS.Timeout | null = null;
  private currentProcess: ChildProcess | null = null;
  private capturing = false;
  private started = false;
  private connected = false;
  private lastFrameAt: Date | null = null;
  private lastError: string | null = null;
  private rtspStats: RtspStreamStats;

  public constructor(config: CameraAdapterConfig = loadConfig()) {
    this.config = config;
    this.rtspStats = {
      connectionAttempts: 0,
      lastConnectionError: null,
      bytesReceived: 0,
      framesCaptured: 0,
      lastValidFrameAt: null,
    };
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

    // Start RTSP stream validation if using RTSP
    if (isRtspSource(this.config.cameraSource)) {
      this.startStreamValidation();
    }

    logger.info("camera adapter started", { 
      source: this.config.cameraSource, 
      fps: this.config.cameraFps,
      rtspEnabled: isRtspSource(this.config.cameraSource),
    });
  }

  public async stop(): Promise<void> {
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.validationTimer) clearInterval(this.validationTimer);
    this.validationTimer = null;
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
      const args = buildFfmpegArgs(this.config.cameraSource, this.config);
      const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
      this.currentProcess = child;
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      const timeout = setTimeout(() => child.kill("SIGKILL"), 15_000);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout.push(chunk);
        this.rtspStats.bytesReceived += chunk.length;
      });
      
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      
      child.once("error", (error) => {
        clearTimeout(timeout);
        this.currentProcess = null;
        this.rtspStats.connectionAttempts++;
        this.rtspStats.lastConnectionError = error.message;
        reject(error);
      });
      
      child.once("close", (code) => {
        clearTimeout(timeout);
        this.currentProcess = null;
        if (code !== 0 || stdout.length === 0) {
          const errorMsg = Buffer.concat(stderr).toString("utf8").trim() || `ffmpeg exited with code ${code ?? -1}`;
          this.rtspStats.connectionAttempts++;
          this.rtspStats.lastConnectionError = errorMsg;
          reject(new Error(errorMsg));
          return;
        }
        this.rtspStats.framesCaptured++;
        this.rtspStats.lastValidFrameAt = new Date();
        resolve({ data: Buffer.concat(stdout), timestamp: new Date(), source: this.config.cameraSource });
      });
    });
  }

  public async healthCheck(): Promise<ComponentHealth> {
    const now = new Date();
    const staleMs = Math.max(5_000, Math.round(3000 / Math.max(this.config.cameraFps, 1)));
    const isFresh = this.lastFrameAt !== null && now.getTime() - this.lastFrameAt.getTime() <= staleMs;
    const status = !this.started ? "degraded" : this.connected && isFresh ? "healthy" : "unhealthy";
    
    let message = !this.started
      ? "camera adapter is stopped"
      : this.connected && isFresh
        ? "camera frames are flowing"
        : this.lastError ?? "camera capture is stale";

    // Add RTSP-specific health details
    if (isRtspSource(this.config.cameraSource)) {
      message += ` [RTSP: ${this.rtspStats.framesCaptured} frames, ${this.rtspStats.connectionAttempts} attempts]`;
      if (this.rtspStats.lastConnectionError) {
        message += ` Last error: ${this.rtspStats.lastConnectionError}`;
      }
    }

    return { component: "camera", status, message, lastCheckedAt: now.toISOString() };
  }

  public getRtspStats(): RtspStreamStats {
    return { ...this.rtspStats };
  }

  private startStreamValidation(): void {
    if (!isRtspSource(this.config.cameraSource)) return;
    
    this.validationTimer = setInterval(async () => {
      if (!this.started || this.capturing) return;
      try {
        const health = await this.healthCheck();
        if (health.status === "unhealthy") {
          logger.warn("RTSP stream validation: unhealthy status detected", { 
            message: health.message,
            stats: this.rtspStats,
          });
          // Attempt reconnection if max attempts not exceeded
          if (this.rtspStats.connectionAttempts < this.config.rtspReconnectMaxAttemptsPerSession) {
            logger.info("RTSP stream validation: attempting reconnection", { 
              attempt: this.rtspStats.connectionAttempts + 1,
              maxAttempts: this.config.rtspReconnectMaxAttemptsPerSession,
            });
          }
        }
      } catch (error) {
        logger.error("RTSP stream validation error", { error });
      }
    }, this.config.rtspStreamValidationIntervalMs);

    logger.info("RTSP stream validation started", { 
      intervalMs: this.config.rtspStreamValidationIntervalMs,
    });
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
      logger.error("camera capture failed", { 
        source: this.config.cameraSource, 
        error: this.lastError,
        rtspStats: this.rtspStats,
      });
    } finally {
      this.capturing = false;
    }
  }
}

export { CameraAdapter as FfmpegCameraAdapter };

export function createCameraAdapter(config: CameraAdapterConfig = loadConfig()): CameraAdapter {
  return new CameraAdapter(config);
}
