import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

const originalEnv = { ...process.env };

function setRequiredEnv(): void {
  process.env.CENTRAL_API_URL = "http://localhost:3000";
  process.env.DEVICE_ID = "ws-test";
  process.env.DEVICE_NAME = "Test Workstation";
}

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("loadConfig", () => {
  it("defaults DETECTION_BATCH_SIZE to OUTBOX_BATCH_SIZE", () => {
    setRequiredEnv();
    process.env.OUTBOX_BATCH_SIZE = "24";
    delete process.env.DETECTION_BATCH_SIZE;

    const config = loadConfig();

    expect(config.outboxBatchSize).toBe(24);
    expect(config.detectionBatchSize).toBe(24);
  });

  it("uses DETECTION_BATCH_SIZE when explicitly set", () => {
    setRequiredEnv();
    process.env.OUTBOX_BATCH_SIZE = "24";
    process.env.DETECTION_BATCH_SIZE = "80";

    const config = loadConfig();

    expect(config.outboxBatchSize).toBe(24);
    expect(config.detectionBatchSize).toBe(80);
  });
});
