import type { MiddlewareHandler } from "hono";
import type { AppBindings } from "../types.js";
import { prisma } from "../lib/prisma.js";
import { fail } from "../utils/json.js";
import { hashToken } from "../utils/crypto.js";

export const requireDevice: MiddlewareHandler<AppBindings> = async (c, next) => {
  const token = c.req.header("x-device-token");
  if (!token) {
    return fail(c, 401, "Device token is required.");
  }

  const tokenHash = hashToken(token);
  const deviceToken = await prisma.deviceToken.findFirst({
    where: {
      tokenHash,
      revokedAt: null,
    },
    include: {
      workstation: true,
      tablet: true,
    },
  });

  if (!deviceToken) {
    return fail(c, 401, "Invalid device token.");
  }

  const deviceKey =
    deviceToken.deviceType === "WORKSTATION"
      ? deviceToken.workstation?.deviceId
      : deviceToken.tablet?.deviceId;

  if (!deviceKey) {
    return fail(c, 401, "Device token is not linked to a device.");
  }

  await prisma.deviceToken.update({
    where: { id: deviceToken.id },
    data: { lastUsedAt: new Date() },
  });

  c.set("device", {
    token: {
      id: deviceToken.id,
      label: deviceToken.label,
      deviceType: deviceToken.deviceType,
      workstationId: deviceToken.workstationId,
      tabletId: deviceToken.tabletId,
    },
    workstation: deviceToken.workstation,
    tablet: deviceToken.tablet,
    deviceKey,
  });

  await next();
};
