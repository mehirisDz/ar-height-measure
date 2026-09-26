import { SignalFilter } from '../src/measurement/SignalFilter';

describe('SignalFilter', () => {
  it('tracks a stable signal closely', () => {
    const filter = new SignalFilter();
    let last = filter.update(1.70, 0);
    for (let i = 1; i < 30; i++) {
      const jitter = i % 2 === 0 ? 0.002 : -0.002;
      last = filter.update(1.70 + jitter, i * 0.05);
    }
    expect(last.value).toBeCloseTo(1.70, 1);
    expect(last.wasOutlier).toBe(false);
  });

  it('rejects a single-frame spike without disturbing the tracked value much', () => {
    const filter = new SignalFilter();
    for (let i = 0; i < 20; i++) {
      filter.update(1.70 + (i % 2 === 0 ? 0.002 : -0.002), i * 0.05);
    }
    const spikeResult = filter.update(3.5, 20 * 0.05);
    expect(spikeResult.wasOutlier).toBe(true);
    expect(spikeResult.value).toBeLessThan(2.0);

    // And the very next normal sample should still be treated normally.
    const after = filter.update(1.701, 21 * 0.05);
    expect(after.wasOutlier).toBe(false);
  });

  it('does not permanently reject a real, sustained change (raising the phone)', () => {
    const filter = new SignalFilter();
    for (let i = 0; i < 20; i++) {
      filter.update(0.9 + (i % 2 === 0 ? 0.002 : -0.002), i * 0.05);
    }
    // Simulate a fast raise to 1.8m over ~10 frames.
    let last;
    for (let i = 0; i < 10; i++) {
      const t = (20 + i) * 0.05;
      const value = 0.9 + (1.8 - 0.9) * (i / 9);
      last = filter.update(value, t);
    }
    expect(last!.value).toBeGreaterThan(1.5);
  });

  it('reset() clears window and filter state', () => {
    const filter = new SignalFilter();
    for (let i = 0; i < 10; i++) filter.update(1.0, i * 0.05);
    filter.reset();
    const result = filter.update(2.0, 0);
    expect(result.value).toBeCloseTo(2.0, 6);
    expect(result.wasOutlier).toBe(false);
  });
});
