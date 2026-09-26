/**
 * A textbook constant-velocity 1D Kalman filter.
 *
 * State: x = [position, velocity]. Process model assumes the true position
 * evolves smoothly (constant velocity plus small random acceleration);
 * measurement model assumes each incoming sample is the true position plus
 * noise. This is the standard "discretized white noise acceleration" model
 * (see e.g. Bar-Shalom, "Estimation with Applications to Tracking and
 * Navigation", ch. 6) — Q is derived from a single accelerationNoise
 * parameter rather than tuned as independent, harder-to-interpret position/
 * velocity noise terms.
 *
 * This filter smooths residual jitter in ARKit's already-fused VIO position
 * estimate; it does not fuse raw sensors itself (ARKit's own internal VIO
 * already does that). Pair it with RobustStats.isOutlier() to reject
 * transient spikes BEFORE they reach the filter — a Kalman filter alone
 * will absorb a single bad measurement, not reject it.
 */
export class KalmanFilter1D {
  private x = 0; // position estimate
  private v = 0; // velocity estimate
  private p00 = 1;
  private p01 = 0;
  private p10 = 0;
  private p11 = 1;
  private lastTimestampSeconds: number | null = null;
  private initialized = false;

  /**
   * @param accelerationNoise Expected magnitude of un-modeled acceleration,
   *   in m/s^2. Larger = filter trusts new measurements more and reacts
   *   faster to real motion, at the cost of more residual jitter. A hand
   *   raising a phone overhead accelerates/decelerates over roughly half a
   *   second, which is the regime this default is tuned for; re-tune against
   *   real device logs once you can test on hardware (see docs/VALIDATION.md).
   * @param measurementNoiseStdDev Expected 1-sigma noise of a single ARKit
   *   position sample, in meters, under good tracking conditions.
   */
  constructor(
    private readonly accelerationNoise = 0.4,
    private readonly measurementNoiseStdDev = 0.004
  ) {}

  reset(initialPosition?: number): void {
    this.x = initialPosition ?? 0;
    this.v = 0;
    this.p00 = 1;
    this.p01 = 0;
    this.p10 = 0;
    this.p11 = 1;
    this.lastTimestampSeconds = null;
    this.initialized = initialPosition !== undefined;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  /** Feeds one accepted (non-outlier) measurement in and returns the new filtered position. */
  update(measurement: number, timestampSeconds: number): number {
    if (!this.initialized || this.lastTimestampSeconds === null) {
      this.x = measurement;
      this.v = 0;
      this.lastTimestampSeconds = timestampSeconds;
      this.initialized = true;
      return this.x;
    }

    // Clamp dt defensively: a stalled frame stream (dt too large) or an
    // out-of-order timestamp (dt <= 0) shouldn't be allowed to blow up P.
    const rawDt = timestampSeconds - this.lastTimestampSeconds;
    const dt = Math.max(1e-3, Math.min(1, rawDt));
    this.lastTimestampSeconds = timestampSeconds;

    // --- Predict ---
    const xPred = this.x + this.v * dt;
    const vPred = this.v;

    const q = this.accelerationNoise * this.accelerationNoise;
    const dt2 = dt * dt;
    const dt3 = dt2 * dt;
    const dt4 = dt3 * dt;
    const q00 = (q * dt4) / 4;
    const q01 = (q * dt3) / 2;
    const q11 = q * dt2;

    const p00Pred = this.p00 + dt * (this.p01 + this.p10) + dt2 * this.p11 + q00;
    const p01Pred = this.p01 + dt * this.p11 + q01;
    const p10Pred = this.p10 + dt * this.p11 + q01; // symmetric with p01Pred
    const p11Pred = this.p11 + q11;

    // --- Update (measurement model z = x + noise) ---
    const r = this.measurementNoiseStdDev * this.measurementNoiseStdDev;
    const innovation = measurement - xPred;
    const s = p00Pred + r;
    const k0 = p00Pred / s;
    const k1 = p10Pred / s;

    this.x = xPred + k0 * innovation;
    this.v = vPred + k1 * innovation;

    this.p00 = (1 - k0) * p00Pred;
    this.p01 = (1 - k0) * p01Pred;
    this.p10 = p10Pred - k1 * p00Pred;
    this.p11 = p11Pred - k1 * p01Pred;

    return this.x;
  }

  getPosition(): number {
    return this.x;
  }

  getVelocity(): number {
    return this.v;
  }

  /** 1-sigma position uncertainty, in the same units as the input measurements. */
  getPositionUncertainty(): number {
    return Math.sqrt(Math.max(0, this.p00));
  }
}
