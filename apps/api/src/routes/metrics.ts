import { Hono } from "hono";
import type { AppBindings } from "../types.js";
import { prisma } from "../lib/prisma.js";
import { ok } from "../utils/json.js";
import { getConnectedTabletCount } from "../lib/tablet-sessions.js";

export const metricsRoutes = new Hono<AppBindings>();

const startedAt = new Date();

metricsRoutes.get("/metrics", async (c) => {
  const now = new Date();
  const uptimeSeconds = Math.floor((now.getTime() - startedAt.getTime()) / 1000);

  const [
    userCount,
    workstationCount,
    tabletCount,
    hitlistCount,
    detectionCount,
    matchEventCount,
    pendingAlerts,
    auditLogCount,
    outboxPending,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.workstation.count(),
    prisma.tablet.count(),
    prisma.hitlist.count(),
    prisma.detection.count(),
    prisma.matchEvent.count(),
    prisma.matchEvent.count({ where: { alertStatus: "PENDING" } }),
    prisma.auditLog.count(),
    prisma.outboxJob.count({ where: { status: "PENDING" } }),
  ]);

  const mem = process.memoryUsage();

  return ok(c, {
    service: "apps/api",
    startedAt: startedAt.toISOString(),
    uptimeSeconds,
    timestamp: now.toISOString(),
    process: {
      pid: process.pid,
      nodeVersion: process.version,
      memoryMb: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      },
    },
    database: {
      users: userCount,
      workstations: workstationCount,
      tablets: tabletCount,
      hitlists: hitlistCount,
      detections: detectionCount,
      matchEvents: matchEventCount,
      pendingAlerts,
      auditLogs: auditLogCount,
      outboxPending,
    },
    realtime: {
      connectedTablets: getConnectedTabletCount(),
    },
  });
});
