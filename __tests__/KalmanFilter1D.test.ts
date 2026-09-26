import { KalmanFilter1D } from '../src/measurement/KalmanFilter1D';

/** Deterministic PRNG (mulberry32) so noisy-signal tests are reproducible. */
function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianNoise(rand: () => number, stdDev: number): number {
  // Box-Muller transform.
  const u1 = Math.max(rand(), 1e-9);
  const u2 = rand();
  return stdDev * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

describe('KalmanFilter1D', () => {
  it('returns the first measurement as-is (nothing to filter against yet)', () => {
    const filter = new KalmanFilter1D();
    expect(filter.update(1.234, 0)).toBeCloseTo(1.234, 9);
  });

  it('converges toward a constant true value when fed noisy samples', () => {
    const filter = new KalmanFilter1D(0.05, 0.006);
    const rand = seededRandom(42);
    const trueValue = 1.75;
    let last = 0;
    for (let i = 0; i < 200; i++) {
      const t = i * 0.05; // 20 Hz
      const noisy = trueValue + gaussianNoise(rand, 0.006);
      last = filter.update(noisy, t);
    }
    expect(last).toBeCloseTo(trueValue, 2);
  });

  it('reduces variance relative to the raw noisy input once converged', () => {
    const filter = new KalmanFilter1D(0.05, 0.006);
    const rand = seededRandom(7);
    const trueValue = 1.5;
    const rawSamples: number[] = [];
    const filteredSamples: number[] = [];
    for (let i = 0; i < 300; i++) {
      const t = i * 0.05;
      const noisy = trueValue + gaussianNoise(rand, 0.006);
      rawSamples.push(noisy);
      filteredSamples.push(filter.update(noisy, t));
    }
    // Compare variance over the back half (after convergence).
    const half = 150;
    const variance = (arr: number[]) => {
      const m = arr.reduce((s, v) => s + v, 0) / arr.length;
      return arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
    };
    const rawVariance = variance(rawSamples.slice(half));
    const filteredVariance = variance(filteredSamples.slice(half));
    expect(filteredVariance).toBeLessThan(rawVariance);
  });

  it('tracks a ramp (constant-velocity motion) with the expected steady-state lag', () => {
    // A phone being raised at a roughly constant speed is exactly the
    // constant-velocity regime this filter models, so it should track a
    // ramp with only a small, bounded lag rather than smoothing it away.
    const filter = new KalmanFilter1D(0.4, 0.004);
    const rand = seededRandom(99);
    const speed = 0.6; // m/s, a plausible "raising the phone" speed
    let lastFiltered = 0;
    let lastTrue = 0;
    for (let i = 0; i < 100; i++) {
      const t = i * 0.02; // 50 Hz
      const trueValue = 0.5 + speed * t;
      const noisy = trueValue + gaussianNoise(rand, 0.004);
      lastFiltered = filter.update(noisy, t);
      lastTrue = trueValue;
    }
    expect(Math.abs(lastFiltered - lastTrue)).toBeLessThan(0.05);
  });

  it('does not get stuck: a sustained step change is eventually tracked, not permanently rejected', () => {
    const filter = new KalmanFilter1D(0.4, 0.004);
    const rand = seededRandom(3);
    // Settle at 0.5m first.
    for (let i = 0; i < 60; i++) {
      filter.update(0.5 + gaussianNoise(rand, 0.004), i * 0.02);
    }
    // Then jump to 1.8m and hold (simulating the phone being raised quickly).
    let last = 0;
    for (let i = 60; i < 120; i++) {
      last = filter.update(1.8 + gaussianNoise(rand, 0.004), i * 0.02);
    }
    expect(last).toBeCloseTo(1.8, 1);
  });

  it('position uncertainty shrinks as more consistent measurements arrive', () => {
    const filter = new KalmanFilter1D(0.05, 0.006);
    const rand = seededRandom(11);
    const initialUncertainty = filter.getPositionUncertainty();
    for (let i = 0; i < 100; i++) {
      filter.update(1.6 + gaussianNoise(rand, 0.006), i * 0.05);
    }
    expect(filter.getPositionUncertainty()).toBeLessThan(initialUncertainty);
  });

  it('reset() clears state back to uninitialized/default', () => {
    const filter = new KalmanFilter1D();
    filter.update(2.0, 0);
    filter.update(2.1, 0.05);
    filter.reset();
    expect(filter.isInitialized).toBe(false);
    expect(filter.getVelocity()).toBe(0);
  });
});
