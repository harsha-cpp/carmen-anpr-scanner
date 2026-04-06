import type { Pool } from "pg";
import { plateHash, encryptPlate, decryptPlate, normalizePlate } from "./crypto";
import { tableRef } from "./db";
import { isInMainHitlist } from "./hitlistClient";

interface DummyEntry {
  plate: string;
  reason: string;
  riskLevel: string;
}

export interface BlacklistRecord {
  plate: string;
  reason: string | null;
  riskLevel: string | null;
  source: string | null;
  createdAt: Date;
}

export interface BlacklistResult {
  isBlacklisted: boolean;
  normalizedPlate: string;
  record: BlacklistRecord | null;
}

const DUMMY_BLACKLIST: DummyEntry[] = [
  { plate: "KA01AB1234", reason: "Stolen vehicle (dummy)", riskLevel: "high" },
  { plate: "TN09XY0001", reason: "Fraud watchlist (dummy)", riskLevel: "medium" },
  { plate: "DL8CAF5030", reason: "Police flag (dummy)", riskLevel: "high" },
];

export async function seedDummyBlacklist(
  db: Pool,
  tableName: string,
): Promise<{ inserted: number; skipped: boolean }> {
  const countRes = await db.query(
    `SELECT COUNT(*)::int AS count FROM ${tableRef(tableName)}`,
  );
  if ((countRes.rows[0] as { count: number }).count > 0) {
    return { inserted: 0, skipped: true };
  }

  let inserted = 0;
  for (const row of DUMMY_BLACKLIST) {
    const res = await db.query(
      `
        INSERT INTO ${tableRef(tableName)}
          (plate_hash, encrypted_plate, reason, risk_level, source, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (plate_hash) DO NOTHING
      `,
      [
        plateHash(row.plate),
        encryptPlate(row.plate),
        row.reason,
        row.riskLevel,
        "seed",
      ],
    );
    inserted += res.rowCount ?? 0;
  }

  return { inserted, skipped: false };
}

export interface BlacklistEntry {
  encryptedPlate: string;
  reason: string | null;
  riskLevel: string | null;
  source: string | null;
  createdAt: Date;
  plate: string;
}

export async function getBlacklistedPlates(
  db: Pool,
  tableName: string,
  limit: number = 50,
): Promise<BlacklistEntry[]> {
  const { rows } = await db.query(
    `
      SELECT encrypted_plate, reason, risk_level, source, created_at
      FROM ${tableRef(tableName)}
      ORDER BY created_at DESC
      LIMIT $1
    `,
    [limit],
  );

  return rows.map((doc: Record<string, unknown>) => ({
    encryptedPlate: doc.encrypted_plate as string,
    reason: doc.reason as string | null,
    riskLevel: doc.risk_level as string | null,
    source: doc.source as string | null,
    createdAt: doc.created_at as Date,
    plate: decryptPlate(doc.encrypted_plate as string),
  }));
}

export async function isPlateBlacklisted(
  db: Pool,
  tableName: string,
  plate: string,
): Promise<BlacklistResult> {
  const normalized = normalizePlate(plate);
  if (!normalized) {
    return { isBlacklisted: false, normalizedPlate: normalized, record: null };
  }

  if (isInMainHitlist(normalized)) {
    return { isBlacklisted: true, normalizedPlate: normalized, record: null };
  }

  const { rows } = await db.query(
    `
      SELECT encrypted_plate, reason, risk_level, source, created_at
      FROM ${tableRef(tableName)}
      WHERE plate_hash = $1
      LIMIT 1
    `,
    [plateHash(normalized)],
  );
  const doc = rows[0] as Record<string, unknown> | undefined;

  if (!doc) {
    return { isBlacklisted: false, normalizedPlate: normalized, record: null };
  }

  return {
    isBlacklisted: true,
    normalizedPlate: normalized,
    record: {
      plate: decryptPlate(doc.encrypted_plate as string),
      reason: doc.reason as string | null,
      riskLevel: doc.risk_level as string | null,
      source: doc.source as string | null,
      createdAt: doc.created_at as Date,
    },
  };
}
