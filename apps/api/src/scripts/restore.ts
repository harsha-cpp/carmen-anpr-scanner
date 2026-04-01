import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../lib/env.js";

/**
 * Restores a pg_dump backup to the central database.
 *
 * Usage:
 *   npx tsx src/scripts/restore.ts ./backups/adarecog_backup_2026-04-01T12-00-00.sql.gz
 *
 * WARNING: This will overwrite ALL data in the target database.
 */
async function main() {
  const backupFile = process.argv[2];

  if (!backupFile) {
    console.error("Usage: npx tsx src/scripts/restore.ts <backup-file>");
    process.exitCode = 1;
    return;
  }

  const filepath = resolve(backupFile);

  if (!existsSync(filepath)) {
    console.error(`Backup file not found: ${filepath}`);
    process.exitCode = 1;
    return;
  }

  const dbUrl = config.databaseUrl;
  const isGzipped = filepath.endsWith(".gz");

  console.log(`Restoring from ${filepath}...`);
  console.log("WARNING: This will overwrite all existing data.");

  try {
    const command = isGzipped
      ? `gunzip -c "${filepath}" | psql "${dbUrl}"`
      : `psql "${dbUrl}" < "${filepath}"`;

    execSync(command, {
      stdio: "inherit",
      timeout: 600_000,
    });
    console.log("Restore completed successfully.");
  } catch (error) {
    console.error("Restore failed:", error);
    process.exitCode = 1;
  }
}

main();
