import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import { loadConfig } from "../config.js";
import { DbClient } from "../db/client.js";
import { createLogger } from "../logger.js";
import type { PendingSnapshot, WorkstationConfig } from "../types.js";

const logger = createLogger("snapshot-capture");

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function retentionUntil(capturedAt: Date, config: WorkstationConfig): string {
  return new Date(capturedAt.getTime() + config.snapshotRetentionDays * 86_400_000).toISOString();
}

function buildSnapshotPath(capturedAt: Date, config: WorkstationConfig): string {
  return join(
    config.snapshotDir,
    String(capturedAt.getUTCFullYear()),
    pad(capturedAt.getUTCMonth() + 1),
    pad(capturedAt.getUTCDate()),
    `${uuidv4()}.jpg`,
  );
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export async function saveSnapshot(frameData: Buffer, config: WorkstationConfig = loadConfig()): Promise<string> {
  const capturedAt = new Date();
  const filePath = buildSnapshotPath(capturedAt, config);
  await mkdir(dirname(filePath), { recursive: true });
  const image = await sharp(frameData)
    .resize({ width: config.snapshotMaxWidth, withoutEnlargement: true })
    .jpeg({ quality: config.snapshotJpegQuality })
    .toBuffer();
  await writeFile(filePath, image);
  logger.info("snapshot saved", { filePath, fileSize: image.length, retentionUntil: retentionUntil(capturedAt, config) });
  return filePath;
}

export async function registerSnapshot(
  db: DbClient,
  detectionId: string,
  filePath: string,
  config: WorkstationConfig = loadConfig(),
  capturedAt = new Date(),
): Promise<PendingSnapshot> {
  const file = await stat(filePath);
  const createdAt = new Date().toISOString();
  const snapshot: PendingSnapshot = {
    id: uuidv4(),
    detectionId,
    filePath,
    fileSize: file.size,
    contentType: "image/jpeg",
    capturedAt: capturedAt.toISOString(),
    compressed: 1,
    uploaded: 0,
    retentionUntil: retentionUntil(capturedAt, config),
    createdAt,
  };
  db.insertSnapshot(snapshot);
  return snapshot;
}

export async function cleanExpiredSnapshots(
  db: DbClient,
  config: WorkstationConfig = loadConfig(),
): Promise<PendingSnapshot[]> {
  const expired = db.deleteExpiredSnapshots(new Date().toISOString());
  await Promise.all(
    expired.map(async (snapshot) => {
      try {
        await unlink(snapshot.filePath);
      } catch (error) {
        if (!isMissingFileError(error)) throw error;
      }
    }),
  );
  logger.info("expired snapshots cleaned", { snapshotDir: config.snapshotDir, count: expired.length });
  return expired;
}
