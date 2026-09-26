import type { NativeTrackingState } from './types';

export interface StabilityResult {
  isStable: boolean;
  reason: string;
}

/**
 * Answers "has ARKit's tracking state been `normal` for long enough that we
 * should trust its output?" ARKit reports `limited` for a brief moment on
 * almost every session start, and again after fast motion or when the
 * camera sees too few features (e.g. pointed at a blank wall) — both are
 * real signals we should respect rather than measuring straight through.
 */
export class StabilityMonitor {
  private normalSinceMs: number | null = null;

  constructor(private readonly minNormalDurationMs: number) {}

  reset(): void {
    this.normalSinceMs = null;
  }

  update(trackingState: NativeTrackingState, timestampMs: number): StabilityResult {
    if (trackingState !== 'normal') {
      this.normalSinceMs = null;
      return { isStable: false, reason: `tracking_${trackingState}` };
    }

    if (this.normalSinceMs === null) {
      this.normalSinceMs = timestampMs;
    }

    const elapsed = timestampMs - this.normalSinceMs;
    if (elapsed < this.minNormalDurationMs) {
      return { isStable: false, reason: 'tracking_warming_up' };
    }

    return { isStable: true, reason: 'tracking_normal' };
  }
}
