import { DeviceMotion, type DeviceMotionMeasurement } from 'expo-sensors';

export interface StillnessConfig {
  /** Rolling window length (samples) used to judge stillness. */
  windowSize: number;
  /** Mean acceleration magnitude (m/s^2, gravity excluded) below which we call the device "still". */
  stillnessThreshold: number;
  /** How often DeviceMotion should report updates, in ms. */
  updateIntervalMs: number;
}

export const DEFAULT_STILLNESS_CONFIG: StillnessConfig = {
  windowSize: 20,
  stillnessThreshold: 0.15,
  updateIntervalMs: 50,
};

type Unsubscribe = () => void;

/**
 * A genuinely additive use of the accelerometer/gyroscope: ARKit's own
 * `trackingState` already reflects large problems (excessive motion,
 * relocalizing), but it does not directly answer "is the user holding the
 * phone steady right now", which matters for deciding when to treat a
 * reading as trustworthy versus mid-motion. DeviceMotion reports at a
 * higher rate than we forward camera frames and is a cheap, independent
 * signal for this — it does not replace or duplicate ARKit's own visual-
 * inertial position tracking.
 */
export class MotionStillnessMonitor {
  private subscription: { remove: Unsubscribe } | null = null;
  private recentMagnitudes: number[] = [];

  constructor(private readonly config: StillnessConfig = DEFAULT_STILLNESS_CONFIG) {}

  start(): void {
    if (this.subscription) return;
    DeviceMotion.setUpdateInterval(this.config.updateIntervalMs);
    this.subscription = DeviceMotion.addListener(this.handleUpdate);
  }

  stop(): void {
    this.subscription?.remove();
    this.subscription = null;
    this.recentMagnitudes = [];
  }

  private handleUpdate = (measurement: DeviceMotionMeasurement): void => {
    const acceleration = measurement.acceleration;
    if (!acceleration) return; // Not available on this platform/device at this moment.
    const magnitude = Math.sqrt(
      acceleration.x ** 2 + acceleration.y ** 2 + acceleration.z ** 2
    );
    this.recentMagnitudes.push(magnitude);
    if (this.recentMagnitudes.length > this.config.windowSize) {
      this.recentMagnitudes.shift();
    }
  };

  /** True once we have a full window and its average magnitude is below the stillness threshold. */
  isStill(): boolean {
    if (this.recentMagnitudes.length < this.config.windowSize) return false;
    const avg =
      this.recentMagnitudes.reduce((sum, v) => sum + v, 0) / this.recentMagnitudes.length;
    return avg < this.config.stillnessThreshold;
  }

  /** Latest instantaneous |user acceleration|, for diagnostics/logging. null until the first sample arrives. */
  getCurrentMagnitude(): number | null {
    return this.recentMagnitudes.length > 0
      ? this.recentMagnitudes[this.recentMagnitudes.length - 1]!
      : null;
  }
}
