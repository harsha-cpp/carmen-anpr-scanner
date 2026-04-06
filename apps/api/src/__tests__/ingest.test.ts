import { describe, expect, it, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppBindings } from "../types.js";

const { prismaMock, writeAuditLogMock } = vi.hoisted(() => ({
  prismaMock: {
    detection: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    outboxJob: {
      create: vi.fn(),
    },
    $executeRaw: vi.fn(),
  },
  writeAuditLogMock: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: prismaMock,
}));

vi.mock("../lib/audit.js", () => ({
  writeAuditLog: writeAuditLogMock,
}));

import { ingestRoutes } from "../routes/ingest.js";

function createTestApp() {
  const app = new Hono<AppBindings>();
  app.use("*", async (c, next) => {
    c.set("device", {
      token: {
        id: "token-1",
        label: "test-device",
        deviceType: "WORKSTATION",
        workstationId: "workstation-1",
        tabletId: null,
      },
      workstation: null,
      tablet: null,
      deviceKey: "workstation-1",
    });
    await next();
  });
  app.route("/", ingestRoutes);
  return app;
}

describe("POST /api/ingest/detections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores detections with a null hitlist when no hitlistId is provided", async () => {
    prismaMock.detection.findUnique.mockResolvedValue(null);
    prismaMock.detection.create.mockResolvedValue({
      id: "detection-1",
      externalEventId: "external-1",
      hitlistId: null,
      plate: "NOMATCH999",
      confidence: 0.78,
    });
    prismaMock.outboxJob.create.mockResolvedValue({ id: "outbox-1" });
    prismaMock.$executeRaw.mockResolvedValue(undefined);
    writeAuditLogMock.mockResolvedValue(undefined);

    const app = createTestApp();
    const res = await app.request(
      new Request("http://localhost/api/ingest/detections", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          externalEventId: "external-1",
          plate: "NOMATCH999",
          occurredAt: "2026-04-06T10:00:00.000Z",
          confidence: 0.78,
        }),
      }),
    );

    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(prismaMock.detection.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        externalEventId: "external-1",
        workstationId: "workstation-1",
        hitlistId: null,
        plate: "NOMATCH999",
        confidence: 0.78,
      }),
    });
    expect(prismaMock.outboxJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        topic: "detection.created",
        aggregateType: "detection",
        aggregateId: "detection-1",
      }),
    });
    expect(writeAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "detection.ingested",
      entityType: "detection",
      entityId: "detection-1",
    }));
  });
});
