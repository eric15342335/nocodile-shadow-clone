export const TRIGGER_CONFIG = {
  positiveThreshold: 0.999,
  releaseThreshold: 0.6,
  holdMs: 500,
  minPositivePredictions: 3,
  maxPositiveGapMs: 250,
  releaseMs: 600,
  cooldownMs: 2000,
} as const;

export type TriggerPhase = "armed" | "holding" | "latched" | "release-required";

export interface TriggerSnapshot {
  phase: TriggerPhase;
  triggered: boolean;
  released: boolean;
  positiveProgress: number;
}

interface TriggerConfig {
  positiveThreshold: number;
  releaseThreshold: number;
  holdMs: number;
  minPositivePredictions: number;
  maxPositiveGapMs: number;
  releaseMs: number;
  cooldownMs: number;
}

/**
 * Pure timing/state helper shared by trainer practice and the effect page.
 * Missing hands are represented as `null`: they can never add positive evidence,
 * but sustained absence is a valid release gesture.
 */
export class GestureTrigger {
  private phase: TriggerPhase = "armed";
  private holdStartedAt: number | null = null;
  private lastPositiveAt: number | null = null;
  private positiveCount = 0;
  private releaseStartedAt: number | null = null;
  private cooldownUntil = 0;

  constructor(private readonly config: TriggerConfig = TRIGGER_CONFIG) {}

  observe(score: number | null, now: number): TriggerSnapshot {
    if (!Number.isFinite(now)) throw new Error("Trigger time must be finite.");
    if (score !== null && (!Number.isFinite(score) || score < 0 || score > 1)) {
      throw new Error("Trigger score must be null or a finite probability from 0 to 1.");
    }

    let triggered = false;
    let released = false;

    if (this.phase === "latched" || this.phase === "release-required") {
      if (score === null || score <= this.config.releaseThreshold) {
        this.releaseStartedAt ??= now;
        if (now - this.releaseStartedAt >= this.config.releaseMs && now >= this.cooldownUntil) {
          this.phase = "armed";
          this.clearPositiveEvidence();
          this.releaseStartedAt = null;
          released = true;
        }
      } else {
        this.releaseStartedAt = null;
      }
      return this.snapshot(triggered, released, now);
    }

    if (score === null || score < this.config.positiveThreshold) {
      this.phase = "armed";
      this.clearPositiveEvidence();
      return this.snapshot(triggered, released, now);
    }

    if (this.lastPositiveAt !== null && now - this.lastPositiveAt > this.config.maxPositiveGapMs) {
      this.clearPositiveEvidence();
    }

    this.holdStartedAt ??= now;
    this.lastPositiveAt = now;
    this.positiveCount += 1;
    this.phase = "holding";

    const heldFor = now - this.holdStartedAt;
    if (
      now >= this.cooldownUntil &&
      heldFor >= this.config.holdMs &&
      this.positiveCount >= this.config.minPositivePredictions
    ) {
      this.phase = "latched";
      this.cooldownUntil = now + this.config.cooldownMs;
      this.releaseStartedAt = null;
      triggered = true;
    }

    return this.snapshot(triggered, released, now);
  }

  /** Reset visual/effect state and require an explicit low/absent release before another trigger. */
  requireRelease(now: number): TriggerSnapshot {
    if (!Number.isFinite(now)) throw new Error("Trigger time must be finite.");
    this.phase = "release-required";
    this.clearPositiveEvidence();
    this.releaseStartedAt = null;
    return this.snapshot(false, false, now);
  }

  /** Use when a different model/session starts and no prior latch should carry across. */
  arm(): void {
    this.phase = "armed";
    this.cooldownUntil = 0;
    this.releaseStartedAt = null;
    this.clearPositiveEvidence();
  }

  getPhase(): TriggerPhase {
    return this.phase;
  }

  private clearPositiveEvidence(): void {
    this.holdStartedAt = null;
    this.lastPositiveAt = null;
    this.positiveCount = 0;
  }

  private snapshot(triggered: boolean, released: boolean, now: number): TriggerSnapshot {
    let progress = 0;
    if (this.phase === "holding" && this.holdStartedAt !== null) {
      const timeProgress = Math.max(
        0,
        Math.min(1, (now - this.holdStartedAt) / this.config.holdMs),
      );
      const countProgress = Math.max(
        0,
        Math.min(1, this.positiveCount / this.config.minPositivePredictions),
      );
      progress = Math.min(timeProgress, countProgress);
    } else if (this.phase === "latched") {
      progress = 1;
    }
    return { phase: this.phase, triggered, released, positiveProgress: progress };
  }
}
