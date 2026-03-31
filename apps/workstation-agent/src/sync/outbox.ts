import { CentralApiClient } from "../api/client.js";
import { DbClient } from "../db/client.js";
import { createLogger } from "../logger.js";
import type {
  DetectionUploadRequest,
  MatchEventUploadRequest,
  PendingDetection,
  PendingMatchEvent,
} from "../types.js";

const logger = createLogger("sync-outbox");

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toDetectionUploadRequest(detection: PendingDetection): DetectionUploadRequest {
  return {
    externalEventId: detection.externalEventId,
    plate: detection.plate,
    occurredAt: detection.occurredAt,
    hitlistId: detection.hitlistId,
    country: detection.country,
    make: detection.make,
    model: detection.model,
    color: detection.color,
    confidence: detection.confidence,
    snapshotUrl: detection.snapshotPath,
  };
}

function toMatchEventUploadRequest(matchEvent: PendingMatchEvent): MatchEventUploadRequest {
  return {
    externalEventId: matchEvent.externalEventId,
    detectionId: matchEvent.detectionId,
    hitlistEntryId: matchEvent.hitlistEntryId,
    alertStatus: matchEvent.alertStatus,
    note: matchEvent.note,
  };
}

export class OutboxFlusher {
  public constructor(
    private readonly api: CentralApiClient,
    private readonly db: DbClient,
  ) {}

  public async flush(batchSize: number): Promise<{
    detectionsSynced: number;
    matchEventsSynced: number;
    errors: number;
  }> {
    const summary = {
      detectionsSynced: 0,
      matchEventsSynced: 0,
      errors: 0,
    };

    const detections = this.db.getUnsyncedDetections(batchSize);
    for (const detection of detections) {
      try {
        await this.api.uploadDetection(toDetectionUploadRequest(detection));
        this.db.markDetectionSynced(detection.id, new Date().toISOString());
        summary.detectionsSynced += 1;
      } catch (error) {
        summary.errors += 1;
        logger.error("detection upload failed", {
          detectionId: detection.id,
          externalEventId: detection.externalEventId,
          error: toErrorMessage(error),
        });
      }
    }

    const matchEvents = this.db.getUnsyncedMatchEvents(batchSize);
    for (const matchEvent of matchEvents) {
      try {
        await this.api.uploadMatchEvent(toMatchEventUploadRequest(matchEvent));
        this.db.markMatchEventSynced(matchEvent.id, new Date().toISOString());
        summary.matchEventsSynced += 1;
      } catch (error) {
        summary.errors += 1;
        logger.error("match event upload failed", {
          matchEventId: matchEvent.id,
          externalEventId: matchEvent.externalEventId,
          error: toErrorMessage(error),
        });
      }
    }

    logger.debug("outbox flush completed", summary);
    return summary;
  }
}
