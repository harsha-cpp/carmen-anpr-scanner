import { v4 as uuidv4 } from "uuid";
import { loadConfig } from "../config.js";
import { DbClient } from "../db/client.js";
import { createLogger } from "../logger.js";
import type { AlertPayload, DetectionEvent, LocalHitlistEntry, MatchResult, PendingMatchEvent } from "../types.js";
import { TtsAnnouncer } from "./tts.js";

const logger = createLogger("alerter");

export class Alerter {
  public constructor(
    private readonly db: DbClient,
    private readonly announcer: TtsAnnouncer,
    private readonly config: ReturnType<typeof loadConfig> = loadConfig(),
  ) {}

  public async handleMatch(detection: DetectionEvent, matchResult: MatchResult): Promise<string[]> {
    if (!matchResult.matched || matchResult.entries.length === 0) {
      return [];
    }

    const matchEventIds: string[] = [];

    for (const entry of matchResult.entries) {
      const matchEventId = uuidv4();
      const alertPayload = this.createAlertPayload(detection, matchResult, entry);
      const matchEvent = this.createMatchEvent(matchEventId, detection, entry, alertPayload);

      this.db.insertMatchEvent(matchEvent);
      matchEventIds.push(matchEventId);
      this.pushAlert(alertPayload);

      if (this.config.ttsEnabled) {
        await this.announcer.announceMatch(
          alertPayload.normalizedPlate,
          alertPayload.priority,
          alertPayload.reasonSummary,
        );
      }
    }

    logger.info("match alerts handled", {
      detectionId: detection.id,
      normalizedPlate: matchResult.normalizedPlate,
      alertCount: matchEventIds.length,
    });

    return matchEventIds;
  }

  private createMatchEvent(
    id: string,
    detection: DetectionEvent,
    entry: LocalHitlistEntry,
    alertPayload: AlertPayload,
  ): PendingMatchEvent {
    return {
      id,
      externalEventId: uuidv4(),
      detectionId: detection.id,
      hitlistEntryId: entry.id,
      alertStatus: "PENDING",
      note: JSON.stringify(alertPayload),
      synced: 0,
      syncedAt: null,
      createdAt: new Date().toISOString(),
    };
  }

  private createAlertPayload(
    detection: DetectionEvent,
    matchResult: MatchResult,
    entry: LocalHitlistEntry,
  ): AlertPayload {
    return {
      plate: detection.plate,
      normalizedPlate: matchResult.normalizedPlate,
      priority: entry.priority,
      hitlistEntryId: entry.id,
      reasonSummary: entry.reasonSummary,
      vehicleDescription: this.buildVehicleDescription(entry),
      detectionId: detection.id,
      occurredAt: detection.occurredAt,
    };
  }

  private buildVehicleDescription(entry: LocalHitlistEntry): string | null {
    const parts = [entry.vehicleColor, entry.vehicleMake, entry.vehicleModel].filter(
      (value): value is string => Boolean(value),
    );

    return parts.length > 0 ? parts.join(" ") : null;
  }

  private pushAlert(payload: AlertPayload): void {
    logger.info("alert queued", { ...payload });
  }
}
