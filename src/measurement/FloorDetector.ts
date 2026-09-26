import { median, medianAbsoluteDeviation } from './RobustStats';
import type { PlaneCandidate } from './types';

/** Reject planes smaller than this in either dimension — almost certainly noise, not a floor. */
const MIN_PLANE_EXTENT_METERS = 0.4;

/** A plane this close to (or above) the camera cannot plausibly be "the floor" the phone is above. */
const MIN_PLAUSIBLE_DROP_METERS = 0.15;

/** A plane this far below the camera is implausible for a hand-held phone-above-head measurement. */
const MAX_PLAUSIBLE_DROP_METERS = 2.6;

/** Once locked, the floor observation window's spread (meters) must be under this to trust the lock. */
const MAX_LOCK_SPREAD_METERS = 0.03;

export interface FloorValidationResult {
  /** The best current candidate, if any pass the basic plausibility filter. */
  candidateId: string | null;
  /** True once enough consistent observations have accumulated to lock the floor. */
  isValidated: boolean;
  /** The Y (meters) to lock in as the floor, only present when isValidated is true. */
  lockedY: number | null;
  reason: string;
}

/**
 * Scores a single plane candidate for "how likely is this the floor",
 * given the camera's current height. Higher is better; very negative scores
 * mean "reject outright" (e.g. explicitly classified as something else).
 */
export function scoreCandidate(plane: PlaneCandidate, cameraY: number): number {
  let score = 0;

  if (plane.classificationStatus === 'known') {
    if (plane.classification === 'floor') {
      score += 100;
    } else if (plane.classification !== 'none') {
      // Confidently classified as something else (wall/table/ceiling/...):
      // strongly disfavor rather than merely ignoring the signal.
      score -= 1000;
    }
  } else if (plane.classificationStatus === 'notAvailable') {
    // Device doesn't support classification at all; fall back entirely on
    // geometric heuristics below. Small flat bonus so this path isn't
    // treated as worse than "undetermined" on a device that DOES support
    // classification but hasn't finished computing it yet.
    score += 10;
  }

  // Reward larger planes (more evidence it's a real, substantial surface),
  // with diminishing returns so one huge plane doesn't dominate everything.
  const area = plane.extentX * plane.extentZ;
  score += Math.min(area, 6) * 4;

  const drop = cameraY - plane.worldY;
  if (drop < MIN_PLAUSIBLE_DROP_METERS || drop > MAX_PLAUSIBLE_DROP_METERS) {
    score -= 1000;
  } else {
    // Mild preference for planes further below the camera, up to a point —
    // helps prefer "the floor" over "a low shelf" when both are visible and
    // neither has a classification yet.
    score += Math.min(drop, 1.2) * 2;
  }

  return score;
}

export function selectFloorCandidate(
  planes: readonly PlaneCandidate[],
  cameraY: number
): PlaneCandidate | null {
  const eligible = planes.filter(
    (p) => p.extentX >= MIN_PLANE_EXTENT_METERS && p.extentZ >= MIN_PLANE_EXTENT_METERS
  );
  if (eligible.length === 0) return null;

  let best: PlaneCandidate | null = null;
  let bestScore = -Infinity;
  for (const plane of eligible) {
    const score = scoreCandidate(plane, cameraY);
    if (score > bestScore) {
      bestScore = score;
      best = plane;
    }
  }

  return bestScore > -500 ? best : null;
}

/**
 * Stateful floor validator. Feed it the current best candidate on every
 * tracking update; once the SAME candidate has been selected consistently
 * (same plane id, low-spread Y readings) for long enough, it reports a
 * locked floor Y. Switching candidates (a different plane wins) restarts
 * the validation window rather than blending across two different surfaces.
 */
export class FloorDetector {
  private currentCandidateId: string | null = null;
  private observations: Array<{ y: number; timestamp: number }> = [];

  constructor(
    private readonly minObservations: number,
    private readonly minDurationMs: number
  ) {}

  reset(): void {
    this.currentCandidateId = null;
    this.observations = [];
  }

  update(candidate: PlaneCandidate | null, timestamp: number): FloorValidationResult {
    if (!candidate) {
      this.reset();
      return { candidateId: null, isValidated: false, lockedY: null, reason: 'no_candidate' };
    }

    if (candidate.id !== this.currentCandidateId) {
      // A different plane won out — start a fresh validation window rather
      // than mixing observations from two different physical surfaces.
      this.currentCandidateId = candidate.id;
      this.observations = [];
    }

    this.observations.push({ y: candidate.worldY, timestamp });
    // Bound memory: keep at most a few seconds worth even if called at a
    // high rate for a long time before ever validating.
    const maxBuffered = this.minObservations * 4;
    if (this.observations.length > maxBuffered) {
      this.observations.splice(0, this.observations.length - maxBuffered);
    }

    if (this.observations.length < this.minObservations) {
      return {
        candidateId: candidate.id,
        isValidated: false,
        lockedY: null,
        reason: 'accumulating_observations',
      };
    }

    const first = this.observations[0]!;
    const last = this.observations[this.observations.length - 1]!;
    const duration = last.timestamp - first.timestamp;
    if (duration < this.minDurationMs) {
      return {
        candidateId: candidate.id,
        isValidated: false,
        lockedY: null,
        reason: 'accumulating_duration',
      };
    }

    const ys = this.observations.map((o) => o.y);
    const med = median(ys);
    const mad = medianAbsoluteDeviation(ys, med);
    // Convert MAD to an approximate standard-deviation-equivalent spread
    // (1.4826x is the standard consistency constant for normal data) and
    // use that as a simple two-sided spread check.
    const approxSpread = mad * 1.4826 * 2;

    if (approxSpread > MAX_LOCK_SPREAD_METERS) {
      return {
        candidateId: candidate.id,
        isValidated: false,
        lockedY: null,
        reason: 'too_much_spread',
      };
    }

    return {
      candidateId: candidate.id,
      isValidated: true,
      lockedY: med,
      reason: 'validated',
    };
  }
}
