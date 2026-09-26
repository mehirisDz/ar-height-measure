import { FloorDetector, scoreCandidate, selectFloorCandidate } from '../src/measurement/FloorDetector';
import type { PlaneCandidate } from '../src/measurement/types';

function makePlane(overrides: Partial<PlaneCandidate> = {}): PlaneCandidate {
  return {
    id: 'plane-1',
    worldY: -1.0,
    extentX: 2,
    extentZ: 2,
    classification: 'none',
    classificationStatus: 'notAvailable',
    firstSeenAt: 0,
    lastUpdatedAt: 0,
    ...overrides,
  };
}

describe('scoreCandidate', () => {
  it('scores a classified floor far above a classified table', () => {
    const cameraY = 0;
    const floor = makePlane({ classification: 'floor', classificationStatus: 'known', worldY: -1.0 });
    const table = makePlane({
      id: 'plane-2',
      classification: 'table',
      classificationStatus: 'known',
      worldY: -0.7,
    });
    expect(scoreCandidate(floor, cameraY)).toBeGreaterThan(scoreCandidate(table, cameraY));
  });

  it('heavily penalizes a plane implausibly close to the camera', () => {
    const cameraY = 0;
    const tooClose = makePlane({ worldY: -0.02 });
    expect(scoreCandidate(tooClose, cameraY)).toBeLessThan(-500);
  });

  it('heavily penalizes a plane above the camera', () => {
    const cameraY = 0;
    const above = makePlane({ worldY: 0.5 });
    expect(scoreCandidate(above, cameraY)).toBeLessThan(-500);
  });

  it('rejects a plane confidently classified as something other than floor', () => {
    const cameraY = 0;
    const wall = makePlane({ classification: 'wall', classificationStatus: 'known', worldY: -1.0 });
    expect(scoreCandidate(wall, cameraY)).toBeLessThan(-500);
  });
});

describe('selectFloorCandidate', () => {
  it('picks the classified floor over an unclassified larger plane', () => {
    const cameraY = 0;
    const floor = makePlane({ id: 'floor', classification: 'floor', classificationStatus: 'known', worldY: -1.0, extentX: 2, extentZ: 2 });
    const bigUnclassified = makePlane({ id: 'big', worldY: -1.0, extentX: 5, extentZ: 5 });
    const result = selectFloorCandidate([floor, bigUnclassified], cameraY);
    expect(result?.id).toBe('floor');
  });

  it('filters out planes smaller than the minimum extent', () => {
    const cameraY = 0;
    const tiny = makePlane({ extentX: 0.1, extentZ: 0.1 });
    expect(selectFloorCandidate([tiny], cameraY)).toBeNull();
  });

  it('returns null when no planes are eligible', () => {
    expect(selectFloorCandidate([], 0)).toBeNull();
  });

  it('returns null when every candidate scores below the acceptance threshold', () => {
    const cameraY = 0;
    const wall = makePlane({ classification: 'wall', classificationStatus: 'known', worldY: -1.0 });
    expect(selectFloorCandidate([wall], cameraY)).toBeNull();
  });
});

describe('FloorDetector (stateful validation)', () => {
  it('does not validate before minObservations is reached', () => {
    const detector = new FloorDetector(10, 500);
    const plane = makePlane();
    let result;
    for (let i = 0; i < 5; i++) {
      result = detector.update(plane, i * 100);
    }
    expect(result!.isValidated).toBe(false);
    expect(result!.reason).toBe('accumulating_observations');
  });

  it('does not validate before minDurationMs is reached, even with enough samples', () => {
    const detector = new FloorDetector(5, 1000);
    const plane = makePlane();
    let result;
    // 5 samples spaced 10ms apart = only 40ms of span, well under 1000ms.
    for (let i = 0; i < 5; i++) {
      result = detector.update(plane, i * 10);
    }
    expect(result!.isValidated).toBe(false);
    expect(result!.reason).toBe('accumulating_duration');
  });

  it('validates and locks a stable floor Y once enough consistent samples accumulate', () => {
    const detector = new FloorDetector(10, 500);
    let result;
    for (let i = 0; i < 12; i++) {
      const plane = makePlane({ worldY: -1.001 + (i % 2 === 0 ? 0.0005 : -0.0005) });
      result = detector.update(plane, i * 60);
    }
    expect(result!.isValidated).toBe(true);
    expect(result!.lockedY).toBeCloseTo(-1.001, 2);
  });

  it('restarts validation when the winning candidate switches to a different plane id', () => {
    const detector = new FloorDetector(5, 100);
    for (let i = 0; i < 5; i++) {
      detector.update(makePlane({ id: 'plane-A', worldY: -1.0 }), i * 60);
    }
    // Switch to a different plane id entirely.
    const result = detector.update(makePlane({ id: 'plane-B', worldY: -0.8 }), 400);
    expect(result.isValidated).toBe(false);
    expect(result.reason).toBe('accumulating_observations');
  });

  it('does not validate when the same plane id is noisy/unstable', () => {
    const detector = new FloorDetector(10, 500);
    let result;
    for (let i = 0; i < 12; i++) {
      // Wildly varying Y for the "same" plane id — shouldn't lock.
      const wobble = (i % 2 === 0 ? 1 : -1) * 0.05;
      result = detector.update(makePlane({ worldY: -1.0 + wobble }), i * 60);
    }
    expect(result!.isValidated).toBe(false);
    expect(result!.reason).toBe('too_much_spread');
  });

  it('resets cleanly', () => {
    const detector = new FloorDetector(3, 50);
    for (let i = 0; i < 3; i++) detector.update(makePlane(), i * 60);
    detector.reset();
    const result = detector.update(makePlane(), 0);
    expect(result.reason).toBe('accumulating_observations');
  });
});
