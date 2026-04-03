import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppBindings } from "../types.js";
import { prisma } from "../lib/prisma.js";
import { fail } from "../utils/json.js";
import { hashToken } from "../utils/crypto.js";
import { createLogger } from "../lib/logger.js";
import { registerTablet, unregisterTablet } from "../lib/tablet-sessions.js";

const logger = createLogger("events");

export const eventRoutes = new Hono<AppBindings>();

async function getAuthorizedWorkstationIds(deviceToken: {
  deviceType: "WORKSTATION" | "TABLET";
  workstationId: string | null;
  tabletId: string | null;
}): Promise<string[]> {
  if (deviceToken.deviceType === "WORKSTATION") {
    return deviceToken.workstationId ? [deviceToken.workstationId] : [];
  }

  if (!deviceToken.tabletId) {
    return [];
  }

  const pairings = await prisma.devicePairing.findMany({
    where: {
      tabletId: deviceToken.tabletId,
      unpairedAt: null,
    },
    select: {
      workstationId: true,
    },
  });

  return pairings.map((pairing) => pairing.workstationId);
}

eventRoutes.get("/api/events/stream", async (c) => {
  const token = c.req.header("x-device-token") ?? c.req.query("token");
  if (!token) {
    return fail(c, 401, "Device token is required.");
  }

  const tokenHash = hashToken(token);
  const deviceToken = await prisma.deviceToken.findFirst({
    where: { tokenHash, revokedAt: null },
    include: { workstation: true, tablet: true },
  });

  if (!deviceToken) {
    return fail(c, 401, "Invalid device token.");
  }

  const deviceKey =
    deviceToken.deviceType === "WORKSTATION"
      ? deviceToken.workstation?.deviceId
      : deviceToken.tablet?.deviceId;

  if (!deviceKey) {
    return fail(c, 401, "Device token not linked to a device.");
  }

  const sinceParam = c.req.query("since");
  const since = sinceParam ? new Date(sinceParam) : null;
  const authorizedWorkstationIds = await getAuthorizedWorkstationIds({
    deviceType: deviceToken.deviceType,
    workstationId: deviceToken.workstationId,
    tabletId: deviceToken.tabletId,
  });

  logger.info({ deviceKey, deviceType: deviceToken.deviceType }, "SSE stream opened");

  return streamSSE(c, async (stream) => {
    let closed = false;

    const sendFn = (event: string, data: string) => {
      if (!closed) {
        stream.writeSSE({ event, data }).catch(() => {
          closed = true;
        });
      }
    };

    const closeFn = () => {
      closed = true;
    };

    registerTablet({
      deviceKey,
      deviceType: deviceToken.deviceType,
      workstationId: deviceToken.workstationId,
      tabletId: deviceToken.tabletId,
      connectedAt: new Date(),
      lastCursor: sinceParam ?? "",
      send: sendFn,
      close: closeFn,
    });

    if (since && !Number.isNaN(since.getTime())) {
      const missedEvents =
        authorizedWorkstationIds.length === 0
          ? []
          : await prisma.matchEvent.findMany({
              where: {
                createdAt: { gt: since },
                workstationId: { in: authorizedWorkstationIds },
              },
              include: {
                detection: {
                  select: {
                    plate: true,
                    country: true,
                    occurredAt: true,
                    snapshotUrl: true,
                  },
                },
                hitlistEntry: {
                  select: {
                    plateOriginal: true,
                    reasonSummary: true,
                    priority: true,
                  },
                },
              },
              orderBy: { createdAt: "asc" },
              take: 200,
            });

      for (const matchEvent of missedEvents) {
        if (closed) break;

        const eventData = JSON.stringify({
          type: "match-event",
          id: matchEvent.id,
          workstationId: matchEvent.workstationId,
          alertStatus: matchEvent.alertStatus,
          detection: matchEvent.detection,
          hitlistEntry: matchEvent.hitlistEntry,
          createdAt: matchEvent.createdAt.toISOString(),
        });
        await stream.writeSSE({ event: "match-event", data: eventData });
      }

      await stream.writeSSE({ event: "replay-complete", data: JSON.stringify({ since: sinceParam }) });
    }

    await stream.writeSSE({ event: "connected", data: JSON.stringify({ deviceKey, timestamp: new Date().toISOString() }) });

    while (!closed) {
      await stream.sleep(15000);
      if (closed) break;
      await stream.writeSSE({ event: "ping", data: new Date().toISOString() });
    }

    unregisterTablet(deviceKey);
    logger.info({ deviceKey }, "SSE stream closed");
  });
});
