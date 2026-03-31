import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";

const logger = createLogger("tts");

interface SaySpeaker {
  speak(
    text: string,
    voice?: string | null,
    speed?: number | null,
    callback?: (error?: Error | null) => void,
  ): void;
}

export class TtsAnnouncer {
  private saySpeakerPromise: Promise<SaySpeaker | null> | null = null;

  public constructor(private readonly config: ReturnType<typeof loadConfig> = loadConfig()) {}

  public async announce(text: string): Promise<void> {
    if (!this.config.ttsEnabled) {
      return;
    }

    try {
      const speaker = await this.getSpeaker();
      if (!speaker) {
        logger.warn("tts speaker unavailable");
        return;
      }

      await new Promise<void>((resolve) => {
        speaker.speak(text, undefined, undefined, (error) => {
          if (error) {
            logger.warn("tts speak failed", { error: error.message, text });
          }

          resolve();
        });
      });
    } catch (error) {
      logger.warn("tts announce failed", {
        error: error instanceof Error ? error.message : String(error),
        text,
      });
    }
  }

  public async announceMatch(plate: string, priority: string | null, reason: string | null): Promise<void> {
    if (!this.config.ttsEnabled) {
      return;
    }

    const parts = [`Alert. Plate ${plate}.`];

    if (priority) {
      parts.push(`Priority ${priority}.`);
    }

    if (reason) {
      parts.push(`Reason ${reason}.`);
    }

    await this.announce(parts.join(" "));
  }

  private async getSpeaker(): Promise<SaySpeaker | null> {
    if (!this.saySpeakerPromise) {
      this.saySpeakerPromise = this.loadSpeaker();
    }

    return this.saySpeakerPromise;
  }

  private async loadSpeaker(): Promise<SaySpeaker | null> {
    try {
      const moduleName = "say";
      const imported: unknown = await import(moduleName);
      const speaker = this.extractSpeaker(imported);

      if (!speaker) {
        logger.warn("say module did not expose a compatible speaker");
      }

      return speaker;
    } catch (error) {
      logger.warn("failed to load say module", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private extractSpeaker(value: unknown): SaySpeaker | null {
    if (typeof value !== "object" || value === null) {
      return null;
    }

    if ("default" in value) {
      return this.extractSpeaker(value.default);
    }

    if (!("speak" in value) || typeof value.speak !== "function") {
      return null;
    }

    return value as SaySpeaker;
  }
}
