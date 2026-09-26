import { KalmanFilter1D } from './KalmanFilter1D';
import { isOutlier } from './RobustStats';

export interface FilterResult {
  value: number;
  uncertaintyMeters: number;
  wasOutlier: boolean;
}

/**
 * Continuously filters a noisy 1D signal (here: the camera's world-space Y)
 * in two stages:
 *
 *  1. A rolling-window, median-based outlier test (RobustStats.isOutlier)
 *     rejects single-frame spikes before they can affect anything.
 *  2. Samples that pass are fed into a 1D Kalman filter for smoothing.
 *
 * This is deliberately NOT a simple moving average: a plain average would
 * treat a momentary tracking glitch the same as a good reading, and would
 * lag badly behind genuine motion (raising the phone). The two stages
 * together reject noise while still tracking real, sustained change.
 *
 * Re-baselining: if several samples in a row get rejected as outliers, that
 * usually means real motion is happening and the rolling window has simply
 * gone stale (still centered on the position before the motion started) —
 * not that the sensor is malfunctioning. After
 * `consecutiveOutlierResetThreshold` rejections in a row, the window is
 * cleared and the next sample is accepted unconditionally, so the filter
 * re-locks onto reality quickly instead of ignoring a real, sustained change
 * forever.
 */
export class SignalFilter {
  private window: number[] = [];
  private consecutiveOutliers = 0;
  private readonly kalman: KalmanFilter1D;

  constructor(
    private readonly windowSize = 20,
    private readonly outlierThreshold = 3.5,
    private readonly consecutiveOutlierResetThreshold = 4,
    kalmanAccelerationNoise = 0.4,
    private readonly measurementNoiseStdDev = 0.004
  ) {
    this.kalman = new KalmanFilter1D(kalmanAccelerationNoise, measurementNoiseStdDev);
  }

  reset(): void {
    this.window = [];
    this.consecutiveOutliers = 0;
    this.kalman.reset();
  }

  update(rawValue: number, timestampSeconds: number): FilterResult {
    const forcedAccept = this.consecutiveOutliers >= this.consecutiveOutlierResetThreshold;
    // The same measurement-noise assumption used to weight the Kalman
    // filter also floors the outlier test's MAD (see RobustStats.isOutlier)
    // — both represent "how much does a single reading legitimately vary".
    const flaggedAsOutlier =
      !forcedAccept &&
      isOutlier(rawValue, this.window, this.outlierThreshold, this.measurementNoiseStdDev);

    if (flaggedAsOutlier) {
      this.consecutiveOutliers++;
      return {
        value: this.kalman.isInitialized ? this.kalman.getPosition() : rawValue,
        uncertaintyMeters: this.kalman.getPositionUncertainty(),
        wasOutlier: true,
      };
    }

    if (forcedAccept) {
      // Real, sustained change: drop the stale window and start a fresh one
      // anchored at the new region instead of slowly fighting our way there.
      this.window = [];
    }
    this.consecutiveOutliers = 0;

    this.window.push(rawValue);
    if (this.window.length > this.windowSize) {
      this.window.shift();
    }

    const filtered = this.kalman.update(rawValue, timestampSeconds);
    return {
      value: filtered,
      uncertaintyMeters: this.kalman.getPositionUncertainty(),
      wasOutlier: false,
    };
  }
}
