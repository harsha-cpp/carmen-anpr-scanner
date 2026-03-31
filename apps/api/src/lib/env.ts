const env = process.env;

function required(name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(env.PORT ?? 3003),
  apiBaseUrl: env.API_BASE_URL ?? "http://localhost:3003",
  databaseUrl: required("DATABASE_URL"),
  betterAuthSecret: required("BETTER_AUTH_SECRET"),
  trustedOrigins: (env.BETTER_AUTH_TRUSTED_ORIGINS ?? "http://localhost:3001")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  deviceProvisioningToken: required("DEVICE_PROVISIONING_TOKEN"),
  seedAdminEmail: env.SEED_ADMIN_EMAIL ?? "admin@example.com",
  seedAdminPassword: env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!",
  seedAdminName: env.SEED_ADMIN_NAME ?? "Platform Admin",
  seedAdminUsername: env.SEED_ADMIN_USERNAME ?? "admin",
};
