import { CentralApiClient } from "../api/client.js";
import { DbClient } from "../db/client.js";
import { createLogger } from "../logger.js";
import type { ComponentHealth, HealthReport, HeartbeatPayload, WorkstationConfig } from "../types.js";

const logger = createLogger("health-heartbeat");

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getOverallStatus(components: ComponentHealth[]): HealthReport["overall"] {
  if (components.some((component) => component.status === "unhealthy")) {
    return "unhealthy";
  }

  if (components.some((component) => component.status === "degraded")) {
    return "degraded";
  }

  return "healthy";
}

export class HeartbeatService {
  public constructor(
    private readonly api: CentralApiClient,
    private readonly db: DbClient,
    private readonly config: WorkstationConfig,
  ) {}

  public async sendHeartbeat(): Promise<void> {
    const memory = process.memoryUsage();
    const uptime = process.uptime();
    const pendingDetections = this.db.getUnsyncedDetections(1).length;
    const pendingMatchEvents = this.db.getUnsyncedMatchEvents(1).length;
    const pendingOutbox = pendingDetections + pendingMatchEvents;
    const health = this.getHealthReport();
    const now = new Date().toISOString();
    const payload: HeartbeatPayload = {
      status: "ACTIVE",
      health,
      metadata: {
        deviceId: this.config.deviceId,
        deviceName: this.config.deviceName,
        uptimeSeconds: uptime,
        pendingOutbox,
        memory: {
          rss: memory.rss,
          heapTotal: memory.heapTotal,
          heapUsed: memory.heapUsed,
          external: memory.external,
          arrayBuffers: memory.arrayBuffers,
        },
      },
    };

    try {
      await this.api.sendHeartbeat(payload);
      this.db.upsertHealthSnapshot({
        component: "heartbeat",
        status: pendingOutbox > 0 ? "degraded" : "healthy",
        message: `heartbeat sent; pendingOutbox=${pendingOutbox}; uptime=${Math.floor(uptime)}s`,
        lastCheckedAt: now,
      });
      logger.debug("heartbeat sent", {
        pendingDetections,
        pendingMatchEvents,
        rss: memory.rss,
      });
    } catch (error) {
      this.db.upsertHealthSnapshot({
        component: "heartbeat",
        status: "unhealthy",
        message: toErrorMessage(error),
        lastCheckedAt: now,
      });
      logger.error("heartbeat failed", { error: toErrorMessage(error) });
      throw error;
    }
  }

  public getHealthReport(): HealthReport {
    const components = this.db.getHealthSnapshots();
    const pendingDetections = this.db.getUnsyncedDetections(1).length;
    const pendingMatchEvents = this.db.getUnsyncedMatchEvents(1).length;

    return {
      overall: getOverallStatus(components),
      components,
      uptime: process.uptime(),
      pendingDetections,
      pendingMatchEvents,
    };
  }
}
