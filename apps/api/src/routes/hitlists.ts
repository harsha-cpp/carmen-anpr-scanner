import { Hono } from "hono";
import type { AppBindings } from "../types.js";
import { prisma } from "../lib/prisma.js";
import { normalizePlate } from "../utils/plate.js";
import { fail, ok } from "../utils/json.js";
import { writeAuditLog } from "../lib/audit.js";

export const hitlistRoutes = new Hono<AppBindings>();

interface HitlistEntryInput {
  plateOriginal?: string;
  plate?: string;
  plateNormalized?: string;
  countryOrRegion?: string;
  priority?: string;
  status?: string;
  reasonCode?: string;
  reasonSummary?: string;
  caseReference?: string;
  sourceAgency?: string;
  validFrom?: string;
  validUntil?: string;
  tags?: string[];
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleColor?: string;
  vehicleCategory?: string;
  ownerName?: string;
  ownerContact?: string;
  extendedCaseNotes?: string;
}

hitlistRoutes.post("/api/hitlists", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : null;

  if (!name) {
    return fail(c, 400, "Hitlist name is required.");
  }

  const hitlist = await prisma.hitlist.create({
    data: {
      name,
      description,
      status: "ACTIVE",
      createdByUserId: user?.id,
    },
  });

  await writeAuditLog({
    actorUser: user,
    action: "hitlist.created",
    entityType: "hitlist",
    entityId: hitlist.id,
    metadata: { name },
  });

  return ok(c, hitlist, 201);
});

hitlistRoutes.get("/api/hitlists", async (c) => {
  const hitlists = await prisma.hitlist.findMany({
    include: {
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return ok(c, hitlists);
});

hitlistRoutes.get("/api/hitlists/:hitlistId", async (c) => {
  const hitlist = await prisma.hitlist.findUnique({
    where: { id: c.req.param("hitlistId") },
    include: {
      versions: {
        include: {
          entries: true,
        },
        orderBy: { versionNumber: "desc" },
      },
    },
  });

  if (!hitlist) {
    return fail(c, 404, "Hitlist not found.");
  }

  return ok(c, hitlist);
});

hitlistRoutes.post("/api/hitlists/:hitlistId/versions", async (c) => {
  const user = c.get("user");
  const hitlistId = c.req.param("hitlistId");
  const body = await c.req.json();
  const note = typeof body.note === "string" ? body.note.trim() : null;
  const entries: HitlistEntryInput[] = Array.isArray(body.entries) ? body.entries : [];

  if (entries.length === 0) {
    return fail(c, 400, "At least one entry is required for a new version.");
  }

  const hitlist = await prisma.hitlist.findUnique({ where: { id: hitlistId } });
  if (!hitlist) {
    return fail(c, 404, "Hitlist not found.");
  }

  const nextVersion = hitlist.currentVersionNumber + 1;

  const version = await prisma.hitlistVersion.create({
    data: {
      hitlistId,
      versionNumber: nextVersion,
      note,
      createdByUserId: user?.id,
      entries: {
        create: entries.map((entry: HitlistEntryInput) => ({
          plateOriginal: String(entry.plateOriginal ?? entry.plate ?? "").trim(),
          plateNormalized: normalizePlate(String(entry.plateNormalized ?? entry.plateOriginal ?? entry.plate ?? "")),
          countryOrRegion: typeof entry.countryOrRegion === "string" ? entry.countryOrRegion : null,
          priority: typeof entry.priority === "string" ? entry.priority : null,
          status: typeof entry.status === "string" ? entry.status : "active",
          reasonCode: typeof entry.reasonCode === "string" ? entry.reasonCode : null,
          reasonSummary: typeof entry.reasonSummary === "string" ? entry.reasonSummary : null,
          caseReference: typeof entry.caseReference === "string" ? entry.caseReference : null,
          sourceAgency: typeof entry.sourceAgency === "string" ? entry.sourceAgency : null,
          validFrom: entry.validFrom ? new Date(entry.validFrom) : null,
          validUntil: entry.validUntil ? new Date(entry.validUntil) : null,
          tags: Array.isArray(entry.tags)
            ? entry.tags.filter((tag): tag is string => typeof tag === "string")
            : undefined,
          vehicleMake: typeof entry.vehicleMake === "string" ? entry.vehicleMake : null,
          vehicleModel: typeof entry.vehicleModel === "string" ? entry.vehicleModel : null,
          vehicleColor: typeof entry.vehicleColor === "string" ? entry.vehicleColor : null,
          vehicleCategory: typeof entry.vehicleCategory === "string" ? entry.vehicleCategory : null,
          ownerName: typeof entry.ownerName === "string" ? entry.ownerName : null,
          ownerContact: typeof entry.ownerContact === "string" ? entry.ownerContact : null,
          extendedCaseNotes: typeof entry.extendedCaseNotes === "string" ? entry.extendedCaseNotes : null,
        })),
      },
    },
    include: { entries: true },
  });

  await prisma.hitlist.update({
    where: { id: hitlistId },
    data: {
      currentVersionNumber: nextVersion,
      status: "ACTIVE",
    },
  });

  await writeAuditLog({
    actorUser: user,
    action: "hitlist.version.created",
    entityType: "hitlist_version",
    entityId: version.id,
    metadata: { hitlistId, versionNumber: nextVersion, entryCount: entries.length },
  });

  return ok(c, version, 201);
});

hitlistRoutes.get("/api/hitlists/:hitlistId/versions", async (c) => {
  const versions = await prisma.hitlistVersion.findMany({
    where: { hitlistId: c.req.param("hitlistId") },
    include: { entries: true },
    orderBy: { versionNumber: "desc" },
  });

  return ok(c, versions);
});
