import { Hono } from "hono";
import type { AppBindings } from "../types.js";
import { prisma } from "../lib/prisma.js";
import { config } from "../lib/env.js";
import { issueDeviceToken } from "../utils/crypto.js";
import { fail, ok } from "../utils/json.js";
import { writeAuditLog } from "../lib/audit.js";

export const deviceRoutes = new Hono<AppBindings>();

deviceRoutes.post("/api/devices/register", async (c) => {
  const provisioningToken = c.req.header("x-provisioning-token");
  if (provisioningToken !== config.deviceProvisioningToken) {
    return fail(c, 401, "Provisioning token is invalid.");
  }

  const body = await c.req.json();
  const deviceType = body.deviceType === "TABLET" ? "TABLET" : body.deviceType === "WORKSTATION" ? "WORKSTATION" : null;
  const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : null;

  if (!deviceType || !deviceId || !name) {
    return fail(c, 400, "deviceType, deviceId, and name are required.");
  }

  if (deviceType === "WORKSTATION") {
    const existing = await prisma.workstation.findUnique({ where: { deviceId } });
    if (existing) {
      return fail(c, 409, "Workstation already registered.");
    }

    const issued = issueDeviceToken();
    const workstation = await prisma.workstation.create({
      data: {
        deviceId,
        name,
        description,
        status: "ACTIVE",
        tokens: {
          create: {
            tokenHash: issued.tokenHash,
            label: "bootstrap",
            deviceType: "WORKSTATION",
          },
        },
      },
      include: { tokens: true },
    });

    await writeAuditLog({
      action: "device.registered",
      entityType: "workstation",
      entityId: workstation.id,
      metadata: { deviceId, deviceType },
    });

    return ok(c, {
      deviceType,
      device: workstation,
      deviceToken: issued.rawToken,
    }, 201);
  }

  const existing = await prisma.tablet.findUnique({ where: { deviceId } });
  if (existing) {
    return fail(c, 409, "Tablet already registered.");
  }

  const issued = issueDeviceToken();
  const tablet = await prisma.tablet.create({
    data: {
      deviceId,
      name,
      description,
      status: "ACTIVE",
      tokens: {
        create: {
          tokenHash: issued.tokenHash,
          label: "bootstrap",
          deviceType: "TABLET",
        },
      },
    },
    include: { tokens: true },
  });

  await writeAuditLog({
    action: "device.registered",
    entityType: "tablet",
    entityId: tablet.id,
    metadata: { deviceId, deviceType },
  });

  return ok(c, {
    deviceType,
    device: tablet,
    deviceToken: issued.rawToken,
  }, 201);
});

deviceRoutes.get("/api/devices", async (c) => {
  const [workstations, tablets, pairings] = await Promise.all([
    prisma.workstation.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.tablet.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.devicePairing.findMany({ orderBy: { createdAt: "desc" } }),
  ]);

  return ok(c, { workstations, tablets, pairings });
});

deviceRoutes.post("/api/devices/pairings", async (c) => {
  const body = await c.req.json();
  const workstationId = typeof body.workstationId === "string" ? body.workstationId : "";
  const tabletId = typeof body.tabletId === "string" ? body.tabletId : "";

  if (!workstationId || !tabletId) {
    return fail(c, 400, "workstationId and tabletId are required.");
  }

  const pairing = await prisma.devicePairing.create({
    data: {
      workstationId,
      tabletId,
    },
  });

  await writeAuditLog({
    actorUser: c.get("user"),
    action: "device.paired",
    entityType: "device_pairing",
    entityId: pairing.id,
    metadata: { workstationId, tabletId },
  });

  return ok(c, pairing, 201);
});
