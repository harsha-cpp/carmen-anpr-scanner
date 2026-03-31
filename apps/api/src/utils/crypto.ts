import { createHash, randomBytes } from "node:crypto";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function issueDeviceToken() {
  const rawToken = `adr_${randomBytes(24).toString("hex")}`;
  return {
    rawToken,
    tokenHash: hashToken(rawToken),
  };
}
