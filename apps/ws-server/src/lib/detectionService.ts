import type { Pool } from "pg";
import { plateHash, encryptPlate, decryptPlate, normalizePlate } from "./crypto";
import { tableRef } from "./db";
import type { BlacklistResult } from "./blacklistService";

export interface Detection {
  timestamp: string;
  plate: string;
  country: string;
  category: string;
  make: string;
  model: string;
  color: string;
  confidence: number;
}

export interface SaveDetectionOptions {
  sessionId?: string | null;
  batchNum?: number | null;
  region?: string | null;
  blacklist?: BlacklistResult;
}

export interface SaveDetectionResult {
  plate: string;
  isBlacklisted: boolean;
  detectedAt: Date;
}

export interface DetectionRecord {
  sessionId: string | null;
  batchNum: number | null;
  region: string | null;
  timestamp: string;
  encryptedPlate: string;
  country: string;
  make: string;
  model: string;
  color: string;
  category: string;
  isBlacklisted: boolean;
  blacklistReason: string | null;
  riskLevel: string | null;
  detectedAt: Date;
  plate: string;
}

export async function saveDetection(
  db: Pool,
  tableName: string,
  detection: Detection,
  options: SaveDetectionOptions = {},
): Promise<SaveDetectionResult> {
  const normalizedPlate = normalizePlate(detection.plate);

  const doc = {
    sessionId: options.sessionId ?? null,
    batchNum: options.batchNum ?? null,
    region: options.region ?? null,
    timestamp: detection.timestamp || "",
    plateHash: plateHash(normalizedPlate),
    encryptedPlate: encryptPlate(normalizedPlate),
    country: detection.country || "",
    make: detection.make || "",
    model: detection.model || "",
    color: detection.color || "",
    category: detection.category || "",
    isBlacklisted: Boolean(options.blacklist?.isBlacklisted),
    blacklistReason: options.blacklist?.record?.reason ?? null,
    riskLevel: options.blacklist?.record?.riskLevel ?? null,
  };

  await db.query(
    `
      INSERT INTO ${tableRef(tableName)}
      (
        session_id, batch_num, region, timestamp,
        plate_hash, encrypted_plate,
        country, make, model, color, category,
        is_blacklisted, blacklist_reason, risk_level, detected_at
      )
      VALUES (
        $1, $2, $3, $4,
        $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14, NOW()
      )
    `,
    [
      doc.sessionId,
      doc.batchNum,
      doc.region,
      doc.timestamp,
      doc.plateHash,
      doc.encryptedPlate,
      doc.country,
      doc.make,
      doc.model,
      doc.color,
      doc.category,
      doc.isBlacklisted,
      doc.blacklistReason,
      doc.riskLevel,
    ],
  );

  return {
    plate: normalizedPlate,
    isBlacklisted: doc.isBlacklisted,
    detectedAt: new Date(),
  };
}

export async function getRecentDetections(
  db: Pool,
  tableName: string,
  limit: number = 100,
): Promise<DetectionRecord[]> {
  const { rows } = await db.query(
    `
      SELECT
        session_id, batch_num, region, timestamp,
        encrypted_plate,
        country, make, model, color, category,
        is_blacklisted, blacklist_reason, risk_level, detected_at
      FROM ${tableRef(tableName)}
      ORDER BY detected_at DESC
      LIMIT $1
    `,
    [limit],
  );

  return rows.map((doc: Record<string, unknown>) => ({
    sessionId: doc.session_id as string | null,
    batchNum: doc.batch_num as number | null,
    region: doc.region as string | null,
    timestamp: doc.timestamp as string,
    encryptedPlate: doc.encrypted_plate as string,
    country: doc.country as string,
    make: doc.make as string,
    model: doc.model as string,
    color: doc.color as string,
    category: doc.category as string,
    isBlacklisted: doc.is_blacklisted as boolean,
    blacklistReason: doc.blacklist_reason as string | null,
    riskLevel: doc.risk_level as string | null,
    detectedAt: doc.detected_at as Date,
    plate: decryptPlate(doc.encrypted_plate as string),
  }));
}
