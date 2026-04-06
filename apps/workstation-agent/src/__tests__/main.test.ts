import { describe, expect, it } from "vitest";
import { buildDetectionArtifacts } from "../main.js";
import type { LocalHitlistEntry, MatchResult } from "../types.js";

function createEntry(overrides: Partial<LocalHitlistEntry> = {}): LocalHitlistEntry {
  return {
    id: "entry-1",
    hitlistId: "hitlist-1",
    plateOriginal: "KA01AB1234",
    plateNormalized: "KA01AB1234",
    countryOrRegion: "IN",
    priority: "high",
    status: "active",
    validFrom: null,
    validUntil: null,
    reasonSummary: "Stolen vehicle",
    vehicleMake: "Toyota",
    vehicleModel: "Innova",
    vehicleColor: "White",
    metadata: null,
    syncedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("buildDetectionArtifacts", () => {
  it("builds a pending detection for non-matches without snapshots or match events", () => {
    const match: MatchResult = {
      matched: false,
      entries: [],
      normalizedPlate: "KA01AB1234",
    };

    const artifacts = buildDetectionArtifacts({
      plate: "KA 01 AB 1234",
      normalizedPlate: "KA01AB1234",
      occurredAt: "2026-04-06T10:00:00.000Z",
      confidence: 0.87,
      snapshotPath: null,
      match,
    });

    expect(artifacts.pendingDetection.plate).toBe("KA 01 AB 1234");
    expect(artifacts.pendingDetection.plateNormalized).toBe("KA01AB1234");
    expect(artifacts.pendingDetection.snapshotPath).toBeNull();
    expect(artifacts.pendingDetection.hitlistId).toBeNull();
    expect(artifacts.pendingDetection.country).toBeNull();
    expect(artifacts.pendingDetection.make).toBeNull();
    expect(artifacts.pendingDetection.model).toBeNull();
    expect(artifacts.pendingDetection.color).toBeNull();
    expect(artifacts.pendingMatchEvents).toHaveLength(0);
    expect(artifacts.alerts).toHaveLength(0);
    expect(artifacts.detectionEvent.id).toBe(artifacts.pendingDetection.id);
    expect(artifacts.detectionEvent.snapshotPath).toBeNull();
  });

  it("keeps snapshots and match records limited to matched detections", () => {
    const entries = [
      createEntry(),
      createEntry({
        id: "entry-2",
        reasonSummary: "Wanted suspect",
        priority: "medium",
      }),
    ];
    const match: MatchResult = {
      matched: true,
      entries,
      normalizedPlate: "KA01AB1234",
    };

    const artifacts = buildDetectionArtifacts({
      plate: "KA01AB1234",
      normalizedPlate: "KA01AB1234",
      occurredAt: "2026-04-06T10:00:00.000Z",
      confidence: 0.93,
      snapshotPath: "./data/snapshots/ka01ab1234.jpg",
      match,
    });

    expect(artifacts.pendingDetection.snapshotPath).toBe("./data/snapshots/ka01ab1234.jpg");
    expect(artifacts.pendingDetection.hitlistId).toBe("hitlist-1");
    expect(artifacts.pendingDetection.country).toBe("IN");
    expect(artifacts.pendingDetection.make).toBe("Toyota");
    expect(artifacts.pendingDetection.model).toBe("Innova");
    expect(artifacts.pendingDetection.color).toBe("White");
    expect(artifacts.pendingMatchEvents).toHaveLength(2);
    expect(artifacts.pendingMatchEvents.every((event) => event.detectionId === null)).toBe(true);
    expect(artifacts.alerts).toHaveLength(2);
    expect(artifacts.alerts[0]?.detectionId).toBe(artifacts.pendingDetection.id);
    expect(artifacts.alerts[0]?.vehicleDescription).toBe("White Toyota Innova");
  });
});
