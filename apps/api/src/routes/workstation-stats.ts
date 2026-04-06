import { Hono } from "hono";
import type { AppBindings } from "../types.js";
import { prisma } from "../lib/prisma.js";
import { fail, ok } from "../utils/json.js";

export const workstationStatsRoutes = new Hono<AppBindings>();

function parseNonNegativeInt(value: string | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

function parseIsoDate(value: string | undefined): Date | null | undefined {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

workstationStatsRoutes.get("/api/workstations/:workstationId/stats", async (c) => {
  const workstationId = c.req.param("workstationId");

  const workstation = await prisma.workstation.findUnique({
    where: { id: workstationId },
    select: { id: true, lastSeenAt: true },
  });

  if (!workstation) {
    return fail(c, 404, "Workstation not found.");
  }

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const [totalDetections, detectionsToday, totalMatches, matchesToday] = await Promise.all([
    prisma.detection.count({ where: { workstationId } }),
    prisma.detection.count({ where: { workstationId, occurredAt: { gte: todayStart } } }),
    prisma.matchEvent.count({ where: { workstationId } }),
    prisma.matchEvent.count({ where: { workstationId, createdAt: { gte: todayStart } } }),
  ]);

  return ok(c, {
    totalDetections,
    detectionsToday,
    totalMatches,
    matchesToday,
    lastSeenAt: workstation.lastSeenAt,
  });
});

workstationStatsRoutes.get("/api/detections", async (c) => {
  const workstationId = c.req.query("workstationId")?.trim() || undefined;
  const from = parseIsoDate(c.req.query("from"));
  const to = parseIsoDate(c.req.query("to"));
  const limit = parseNonNegativeInt(c.req.query("limit"), 50);
  const offset = parseNonNegativeInt(c.req.query("offset"), 0);

  if (from === undefined || to === undefined) {
    return fail(c, 400, "from and to must be valid ISO date strings.");
  }

  if (from && to && from > to) {
    return fail(c, 400, "from must be earlier than or equal to to.");
  }

  if (limit === null || limit < 1) {
    return fail(c, 400, "limit must be a positive integer.");
  }

  if (offset === null) {
    return fail(c, 400, "offset must be a non-negative integer.");
  }

  const clampedLimit = Math.min(limit, 200);

  const where = {
    workstationId,
    occurredAt:
      from || to
        ? { gte: from ?? undefined, lte: to ?? undefined }
        : undefined,
  };

  const [detections, total] = await Promise.all([
    prisma.detection.findMany({
      where,
      include: {
        workstation: { select: { name: true } },
      },
      orderBy: { occurredAt: "desc" },
      skip: offset,
      take: clampedLimit,
    }),
    prisma.detection.count({ where }),
  ]);

  return ok(c, { detections, total });
});
