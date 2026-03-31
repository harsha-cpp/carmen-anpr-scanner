import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { config } from "../lib/env.js";

async function main() {
  await prisma.role.upsert({
    where: { name: "admin" },
    update: {
      description: "Central platform administrators",
      permissions: ["*"] as never,
    },
    create: {
      name: "admin",
      description: "Central platform administrators",
      permissions: ["*"] as never,
    },
  });

  await prisma.role.upsert({
    where: { name: "operator" },
    update: {
      description: "Central platform operators",
      permissions: ["hitlists:read", "devices:read", "alerts:read"] as never,
    },
    create: {
      name: "operator",
      description: "Central platform operators",
      permissions: ["hitlists:read", "devices:read", "alerts:read"] as never,
    },
  });

  const existing = await prisma.user.findUnique({
    where: { email: config.seedAdminEmail },
  });

  if (existing) {
    console.log(`Admin already exists: ${existing.email}`);
    return;
  }

  const user = await prisma.user.create({
    data: {
      email: config.seedAdminEmail,
      name: config.seedAdminName,
      username: config.seedAdminUsername,
      displayUsername: config.seedAdminUsername,
      role: "admin",
      emailVerified: true,
    },
  });

  await prisma.account.create({
    data: {
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: await bcrypt.hash(config.seedAdminPassword, 10),
    },
  });

  console.log(`Seeded admin ${config.seedAdminEmail} / ${config.seedAdminUsername}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
