import { Barometer, type BarometerMeasurement } from 'expo-sensors';

type Unsubscribe = () => void;

/**
 * Reads the real barometer (CMAltimeter-backed relative altitude) purely
 * for diagnostics/logging. It is intentionally NOT fused into the height
 * calculation anywhere in this engine.
 *
 * Why: `relativeAltitude` is derived from ambient pressure changes, and at
 * the scale this app cares about (roughly 0-2.5m, wanting cm-level
 * accuracy) its noise floor is the wrong shape for the job:
 *  - Pressure sensors are built and calibrated to resolve building-scale
 *    changes (one floor to the next, tens of meters), not sub-meter arm's-
 *    reach distances.
 *  - Ambient pressure drifts with weather, HVAC cycling, doors/windows
 *    opening, and even elevators moving elsewhere in a building — all
 *    indistinguishable, from the pressure signal alone, from the phone
 *    actually moving.
 *  - Its useful signal-to-noise ratio only improves by integrating over
 *    tens of seconds to minutes, whereas this measurement happens over a
 *    couple of seconds.
 * Naively fusing it in would, at best, do nothing, and at worst inject
 * weather-driven drift into a number that ARKit alone already resolves to
 * millimeters. If you want to experiment with it later (e.g. as a coarse
 * plausibility cross-check, or across a much longer session), the real
 * sensor data is available here — see getLatest().
 */
export class BarometerReader {
  private subscription: { remove: Unsubscribe } | null = null;
  private latest: BarometerMeasurement | null = null;

  static isAvailable(): Promise<boolean> {
    return Barometer.isAvailableAsync();
  }

  start(): void {
    if (this.subscription) return;
    this.subscription = Barometer.addListener((measurement: BarometerMeasurement) => {
      this.latest = measurement;
    });
  }

  stop(): void {
    this.subscription?.remove();
    this.subscription = null;
    this.latest = null;
  }

  /** Most recent real reading, or null if not started / no data yet. Diagnostic use only — see class doc. */
  getLatest(): BarometerMeasurement | null {
    return this.latest;
  }
}
