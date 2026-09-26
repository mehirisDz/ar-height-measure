import { isOutlier, median, medianAbsoluteDeviation, modifiedZScore } from '../src/measurement/RobustStats';

describe('median', () => {
  it('computes the median of an odd-length array', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('computes the median of an even-length array as the average of the middle two', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('is unaffected by input order', () => {
    expect(median([5, 1, 4, 2, 3])).toBe(3);
  });

  it('throws on an empty array rather than returning a misleading number', () => {
    expect(() => median([])).toThrow();
  });
});

describe('medianAbsoluteDeviation', () => {
  it('is zero for a constant array', () => {
    expect(medianAbsoluteDeviation([5, 5, 5, 5])).toBe(0);
  });

  it('matches a hand-computed value for a simple array', () => {
    // median = 3; deviations = [2,1,0,1,2]; median of deviations = 1
    expect(medianAbsoluteDeviation([1, 2, 3, 4, 5])).toBe(1);
  });
});

describe('modifiedZScore / isOutlier', () => {
  const stableWindow = [1.70, 1.71, 1.69, 1.70, 1.72, 1.68, 1.71, 1.70];

  it('does not flag a value consistent with the window', () => {
    expect(isOutlier(1.705, stableWindow)).toBe(false);
  });

  it('flags a single far-away spike', () => {
    expect(isOutlier(2.5, stableWindow)).toBe(true);
  });

  it('requires at least 8 points of context before calling anything an outlier', () => {
    expect(isOutlier(100, [1, 1, 1])).toBe(false);
    expect(isOutlier(100, [1, 1, 1, 1, 1, 1, 1])).toBe(false); // still only 7
  });

  it('does not flag a value within the default noise-floor assumption of a flat window', () => {
    // Using the default minMad (4mm): a 1cm deviation is within noise for a
    // signal we've told the test to assume is this noisy.
    expect(isOutlier(5.01, [5, 5, 5, 5, 5, 5, 5, 5])).toBe(false);
  });

  it('flags a value clearly beyond the noise-floor assumption of a flat window', () => {
    // 3cm >> the 4mm default noise floor: z = 0.6745 * 0.03 / 0.004 ≈ 5.06.
    expect(isOutlier(5.03, [5, 5, 5, 5, 5, 5, 5, 5])).toBe(true);
  });

  it('does NOT lock into a false-positive spiral when a window has a slight majority value', () => {
    // Regression test: a window with a 5-3 majority split used to produce a
    // MAD of exactly 0 (median-of-deviations lands on the majority's zero
    // deviation). With no floor at all, that sends the modified z-score to
    // Infinity for the minority value, and rejecting it means it never
    // enters the window either — so the majority's grip only tightens,
    // permanently "freezing" the filter on ordinary alternating jitter.
    // Flooring MAD at a realistic noise assumption (the default here, 4mm)
    // fixes this: the minority value is 4mm from the median, i.e. exactly
    // at the noise floor, which is not "meaningfully" different from it.
    const skewedWindow = [1.702, 1.702, 1.702, 1.698, 1.698, 1.702, 1.698, 1.702];
    expect(isOutlier(1.698, skewedWindow)).toBe(false);
  });

  it('modifiedZScore is signed (negative for values below the median)', () => {
    expect(modifiedZScore(1.60, stableWindow, 0.004)).toBeLessThan(0);
    expect(modifiedZScore(1.80, stableWindow, 0.004)).toBeGreaterThan(0);
  });
});
