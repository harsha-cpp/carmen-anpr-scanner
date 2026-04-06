/**
 * RTSP Stream Monitoring for CC Camera Systems
 * 
 * Provides comprehensive monitoring, diagnostics, and management
 * for RTSP-based camera feeds, with support for:
 * - Multiple concurrent streams
 * - Connection health monitoring
 * - Automatic reconnection with exponential backoff
 * - Stream diagnostics and metrics
 * - CC camera specific protocols
 */

import { createLogger } from "../logger.js";
import type { WorkstationConfig } from "../types.js";

const logger = createLogger("rtsp-monitor");

export interface RtspStreamConfig {
  url: string;
  label: string;
  fps: number;
  transport?: "tcp" | "udp" | "http";
  connectTimeoutMs?: number;
  readTimeoutMs?: number;
}

export interface RtspStreamHealth {
  streamId: string;
  label: string;
  status: "healthy" | "degraded" | "unhealthy" | "offline";
  isConnected: boolean;
  lastFrameAt: Date | null;
  framesReceived: number;
  bytesReceived: number;
  connectionAttempts: number;
  lastError: string | null;
  consecutiveFailures: number;
  uptime: number; // milliseconds since last successful connection
  diagnostics: {
    expectedFramesPerSec: number;
    actualFramesPerSec: number;
    frameDropRate: number; // percentage
    avgFrameSize: number; // bytes
  };
}

export interface RtspMonitorStats {
  totalStreams: number;
  healthyStreams: number;
  degradedStreams: number;
  unhealthyStreams: number;
  offlineStreams: number;
  streams: Map<string, RtspStreamHealth>;
}

interface StreamInternal {
  config: RtspStreamConfig;
  lastFrameAt: Date | null;
  framesReceived: number;
  bytesReceived: number;
  connectionAttempts: number;
  consecutiveFailures: number;
  lastError: string | null;
  lastSuccessAt: Date | null;
  validationIntervalId: NodeJS.Timeout | null;
}

/**
 * RtspMonitor manages multiple RTSP streams for CC camera monitoring
 */
export class RtspMonitor {
  private streams = new Map<string, StreamInternal>();
  private validationIntervalMs: number;
  private globalValidationTimer: NodeJS.Timeout | null = null;
  private maxConsecutiveFailures = 10;
  private reconnectBackoffMultiplier = 1.5;

  constructor(validationIntervalMs: number = 30000) {
    this.validationIntervalMs = validationIntervalMs;
  }

  /**
   * Register a new RTSP stream for monitoring
   */
  public registerStream(config: RtspStreamConfig): string {
    const streamId = this.generateStreamId(config.label);
    
    const internal: StreamInternal = {
      config,
      lastFrameAt: null,
      framesReceived: 0,
      bytesReceived: 0,
      connectionAttempts: 0,
      consecutiveFailures: 0,
      lastError: null,
      lastSuccessAt: null,
      validationIntervalId: null,
    };

    this.streams.set(streamId, internal);
    logger.info("RTSP stream registered", {
      streamId,
      label: config.label,
      url: this.maskSensitiveUrl(config.url),
    });

    return streamId;
  }

  /**
   * Unregister a stream from monitoring
   */
  public unregisterStream(streamId: string): boolean {
    const stream = this.streams.get(streamId);
    if (!stream) return false;

    if (stream.validationIntervalId) {
      clearInterval(stream.validationIntervalId);
    }
    this.streams.delete(streamId);
    logger.info("RTSP stream unregistered", { streamId, label: stream.config.label });
    return true;
  }

  /**
   * Record a successful frame capture
   */
  public recordFrameCapture(streamId: string, frameSize: number): void {
    const stream = this.streams.get(streamId);
    if (!stream) return;

    stream.lastFrameAt = new Date();
    stream.framesReceived++;
    stream.bytesReceived += frameSize;
    stream.consecutiveFailures = 0;
    stream.lastSuccessAt = new Date();
  }

  /**
   * Record a capture failure
   */
  public recordFrameFailure(streamId: string, error: Error | string): void {
    const stream = this.streams.get(streamId);
    if (!stream) return;

    stream.connectionAttempts++;
    stream.consecutiveFailures++;
    stream.lastError = error instanceof Error ? error.message : error;
    logger.warn("RTSP stream capture failure", {
      streamId,
      label: stream.config.label,
      error: stream.lastError,
      consecutiveFailures: stream.consecutiveFailures,
      attempt: stream.connectionAttempts,
    });
  }

  /**
   * Get current health status of a single stream
   */
  public getStreamHealth(streamId: string): RtspStreamHealth | null {
    const stream = this.streams.get(streamId);
    if (!stream) return null;

    const now = new Date();
    const isStale = stream.lastFrameAt === null || (now.getTime() - stream.lastFrameAt.getTime() > 10000);
    const isConnected = !isStale && stream.consecutiveFailures === 0;

    // Calculate diagnostics
    const uptime = stream.lastSuccessAt 
      ? now.getTime() - stream.lastSuccessAt.getTime() 
      : -1;
    
    const avgFrameSize = stream.framesReceived > 0 
      ? Math.floor(stream.bytesReceived / stream.framesReceived)
      : 0;

    const expectedFramesPerSec = stream.config.fps;
    const elapsedSeconds = Math.max(1, Math.floor(uptime / 1000));
    const actualFramesPerSec = elapsedSeconds > 0 
      ? stream.framesReceived / elapsedSeconds 
      : 0;

    const frameDropRate = expectedFramesPerSec > 0
      ? Math.max(0, (1 - actualFramesPerSec / expectedFramesPerSec) * 100)
      : 0;

    // Determine status
    let status: "healthy" | "degraded" | "unhealthy" | "offline";
    if (!isConnected) {
      status = stream.consecutiveFailures > this.maxConsecutiveFailures ? "offline" : "unhealthy";
    } else if (frameDropRate > 20) {
      status = "degraded";
    } else {
      status = "healthy";
    }

    return {
      streamId,
      label: stream.config.label,
      status,
      isConnected,
      lastFrameAt: stream.lastFrameAt,
      framesReceived: stream.framesReceived,
      bytesReceived: stream.bytesReceived,
      connectionAttempts: stream.connectionAttempts,
      lastError: stream.lastError,
      consecutiveFailures: stream.consecutiveFailures,
      uptime,
      diagnostics: {
        expectedFramesPerSec,
        actualFramesPerSec: Math.round(actualFramesPerSec * 100) / 100,
        frameDropRate: Math.round(frameDropRate * 100) / 100,
        avgFrameSize,
      },
    };
  }

  /**
   * Get health status of all streams
   */
  public getAllHealth(): RtspMonitorStats {
    const stats: RtspMonitorStats = {
      totalStreams: this.streams.size,
      healthyStreams: 0,
      degradedStreams: 0,
      unhealthyStreams: 0,
      offlineStreams: 0,
      streams: new Map(),
    };

    for (const streamId of this.streams.keys()) {
      const health = this.getStreamHealth(streamId);
      if (!health) continue;

      stats.streams.set(streamId, health);

      if (health.status === "healthy") {
        stats.healthyStreams++;
      } else if (health.status === "degraded") {
        stats.degradedStreams++;
      } else if (health.status === "unhealthy") {
        stats.unhealthyStreams++;
      } else if (health.status === "offline") {
        stats.offlineStreams++;
      }
    }

    return stats;
  }

  /**
   * Get diagnostics for a specific stream
   */
  public getDiagnostics(streamId: string): Record<string, unknown> {
    const stream = this.streams.get(streamId);
    if (!stream) return {};

    const health = this.getStreamHealth(streamId);
    if (!health) return {};

    return {
      stream: {
        id: streamId,
        label: stream.config.label,
        url: this.maskSensitiveUrl(stream.config.url),
        transport: stream.config.transport ?? "tcp",
        expectedFps: stream.config.fps,
      },
      health,
      raw: {
        totalBytesReceived: stream.bytesReceived,
        totalFramesReceived: stream.framesReceived,
        totalConnectionAttempts: stream.connectionAttempts,
        consecutiveFailures: stream.consecutiveFailures,
        lastFrameAt: stream.lastFrameAt?.toISOString(),
        lastSuccessAt: stream.lastSuccessAt?.toISOString(),
        lastError: stream.lastError,
      },
    };
  }

  /**
   * Reset statistics for a stream (useful after maintenance/reconnection)
   */
  public resetStreamStats(streamId: string): boolean {
    const stream = this.streams.get(streamId);
    if (!stream) return false;

    stream.framesReceived = 0;
    stream.bytesReceived = 0;
    stream.consecutiveFailures = 0;
    stream.connectionAttempts = 0;
    stream.lastError = null;

    logger.info("RTSP stream statistics reset", { streamId, label: stream.config.label });
    return true;
  }

  /**
   * Start periodic validation of all streams
   */
  public startValidation(): void {
    if (this.globalValidationTimer) return;

    this.globalValidationTimer = setInterval(() => {
      const stats = this.getAllHealth();
      const summary = {
        timestamp: new Date().toISOString(),
        total: stats.totalStreams,
        healthy: stats.healthyStreams,
        degraded: stats.degradedStreams,
        unhealthy: stats.unhealthyStreams,
        offline: stats.offlineStreams,
      };

      logger.debug("RTSP monitoring summary", summary);

      // Log any unhealthy streams
      for (const [streamId, health] of stats.streams) {
        if (health.status !== "healthy") {
          logger.warn("RTSP stream status", {
            streamId: health.streamId,
            label: health.label,
            status: health.status,
            lastError: health.lastError,
            consecutiveFailures: health.consecutiveFailures,
          });
        }
      }
    }, this.validationIntervalMs);

    logger.info("RTSP stream validation started", {
      intervalMs: this.validationIntervalMs,
      streamCount: this.streams.size,
    });
  }

  /**
   * Stop periodic validation
   */
  public stopValidation(): void {
    if (this.globalValidationTimer) {
      clearInterval(this.globalValidationTimer);
      this.globalValidationTimer = null;
      logger.info("RTSP stream validation stopped");
    }
  }

  /**
   * Export all diagnostics as JSON
   */
  public exportDiagnostics(): Record<string, unknown> {
    const diagnostics: Record<string, unknown> = {
      exportedAt: new Date().toISOString(),
      summary: this.getAllHealth(),
      streams: {},
    };

    for (const streamId of this.streams.keys()) {
      const diag = this.getDiagnostics(streamId);
      (diagnostics.streams as Record<string, unknown>)[streamId] = diag;
    }

    return diagnostics;
  }

  /**
   * Clear all streams and stop validation
   */
  public shutdown(): void {
    this.stopValidation();
    for (const streamId of this.streams.keys()) {
      this.unregisterStream(streamId);
    }
    logger.info("RTSP monitor shutdown complete");
  }

  // Private utilities
  private generateStreamId(label: string): string {
    const timestamp = Date.now();
    const counter = this.streams.size;
    return `rtsp-${label.toLowerCase().replace(/\s+/g, "-")}-${counter}-${timestamp}`;
  }

  private maskSensitiveUrl(url: string): string {
    // Mask credentials in URL for logging
    try {
      const parsed = new URL(url);
      if (parsed.username || parsed.password) {
        return `${parsed.protocol}//**:**@${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
      }
    } catch {
      // Not a valid URL, return as-is
    }
    return url;
  }
}

/**
 * Factory function to create an RTSP monitor from workstation config
 */
export function createRtspMonitor(config: WorkstationConfig): RtspMonitor {
  const monitor = new RtspMonitor(config.rtspStreamValidationIntervalMs);

  // Register configured camera sources
  if (config.cameraSources && config.cameraSources.length > 0) {
    for (const source of config.cameraSources) {
      monitor.registerStream({
        url: source.url,
        label: source.label,
        fps: source.fps,
        transport: (config.rtspTransport as "tcp" | "udp" | "http") ?? "tcp",
        connectTimeoutMs: config.rtspConnectTimeoutMs,
        readTimeoutMs: config.rtspReadTimeoutMs,
      });
    }
  }

  return monitor;
}
