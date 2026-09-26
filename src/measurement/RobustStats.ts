/**
 * Pure statistics helpers with no dependency on React Native, Expo, or
 * anything else that requires a device — these are fully unit-testable in
 * plain Node. See __tests__/RobustStats.test.ts.
 */

export function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error('median() called with an empty array');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Median absolute deviation: a robust (outlier-resistant) stand-in for standard deviation. */
export function medianAbsoluteDeviation(values: readonly number[], center?: number): number {
  const med = center ?? median(values);
  const deviations = values.map((v) => Math.abs(v - med));
  return median(deviations);
}

/**
 * The Iglewicz-Hoaglin modified z-score: how many (robust) MADs `value` sits
 * from the window's median. 0.6745 is the constant that makes MAD comparable
 * to a standard deviation for normally-distributed data.
 *
 * `minMad` floors the MAD before dividing, and should be set to the
 * caller's best estimate of the signal's genuine sensor-noise magnitude —
 * NOT an arbitrarily tiny epsilon. Without a realistic floor, a small or
 * coincidentally-clustered window can produce a MAD well below the
 * signal's true noise level, not because the signal is actually that
 * quiet, but because a short sample happened to have a lopsided majority
 * value. Dividing by that unrealistically small MAD inflates the score for
 * the very next (perfectly normal) reading on the minority side, flagging
 * it as an outlier. Once rejected, it never enters the window either, so
 * the majority's grip only tightens — a self-reinforcing lock-in that,
 * left unfixed, can permanently "freeze" the filter during exactly the
 * ordinary jitter it's supposed to see through. Flooring MAD at the
 * expected noise level caps how confident the score is allowed to get from
 * a small sample alone.
 */
export function modifiedZScore(
  value: number,
  windowValues: readonly number[],
  minMad: number
): number {
  const med = median(windowValues);
  const mad = Math.max(medianAbsoluteDeviation(windowValues, med), minMad);
  return (0.6745 * (value - med)) / mad;
}

/**
 * Whether `value` should be treated as an outlier relative to
 * `windowValues`, using the modified z-score test. Requires at least 8
 * points of context; with fewer, everything is accepted (there isn't enough
 * information yet to get a reliable spread estimate, let alone call
 * something an outlier).
 *
 * @param minMad See modifiedZScore(). Defaults to 4mm, a reasonable
 *   generic ARKit-position-noise assumption; pass the same figure you use
 *   elsewhere for this signal's expected measurement noise when you have
 *   one (SignalFilter does exactly this).
 */
export function isOutlier(
  value: number,
  windowValues: readonly number[],
  threshold = 3.5,
  minMad = 0.004
): boolean {
  if (windowValues.length < 8) return false;
  return Math.abs(modifiedZScore(value, windowValues, minMad)) > threshold;
}
