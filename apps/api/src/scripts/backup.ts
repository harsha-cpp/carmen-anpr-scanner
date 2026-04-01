import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../lib/env.js";

/**
 * Creates a pg_dump backup of the central database.
 *
 * Usage:
 *   npx tsx src/scripts/backup.ts
 *   npx tsx src/scripts/backup.ts /custom/backup/dir
 */
async function main() {
  const backupDir = resolve(process.argv[2] ?? "./backups");
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `adarecog_backup_${timestamp}.sql.gz`;
  const filepath = resolve(backupDir, filename);

  const dbUrl = config.databaseUrl;

  console.log(`Starting backup to ${filepath}...`);

  try {
    execSync(`pg_dump "${dbUrl}" | gzip > "${filepath}"`, {
      stdio: "inherit",
      timeout: 300_000,
    });
    console.log(`Backup completed: ${filepath}`);
  } catch (error) {
    console.error("Backup failed:", error);
    process.exitCode = 1;
  }
}

main();
