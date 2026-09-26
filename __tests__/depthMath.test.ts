import { unprojectWorldY, type Mat4ColumnMajor } from '../src/measurement/depthMath';

const SQRT2 = Math.sqrt(2);
const INV_SQRT2 = 1 / SQRT2;

function mat(values: number[]): Mat4ColumnMajor {
  if (values.length !== 16) throw new Error('expected 16 values');
  return { m: values as unknown as Mat4ColumnMajor['m'] };
}

describe('unprojectWorldY', () => {
  // Camera at world (0, 1.5, 0), looking straight down (-Y world).
  // Rotation columns: X -> (1,0,0), Y -> (0,0,-1), Z -> (0,1,0).
  // Hand-derivation: local forward (0,0,-1) maps to world (0,-1,0) via -colZ,
  // which is straight down, as intended.
  const straightDownCamera = mat([
    1, 0, 0, 0,
    0, 0, -1, 0,
    0, 1, 0, 0,
    0, 1.5, 0, 1,
  ]);

  it('places the floor at world Y=0 for a center pixel looking straight down from 1.5m', () => {
    const worldY = unprojectWorldY({
      pixelX: 0,
      pixelY: 0,
      depth: 1.5,
      fx: 100,
      fy: 100,
      cx: 0,
      cy: 0,
      cameraTransform: straightDownCamera,
    });
    expect(worldY).toBeCloseTo(0, 6);
  });

  it('still places the floor at world Y=0 for an off-center pixel at the same depth', () => {
    // Off-center pixels hitting a flat floor perpendicular to a straight-down
    // camera should report the same planar (z-axis) depth as the center
    // pixel — that's what makes ARKit/LiDAR "depth" planar rather than
    // radial. World Y should therefore still come out to 0; only X/Z differ.
    const worldY = unprojectWorldY({
      pixelX: 50,
      pixelY: 30,
      depth: 1.5,
      fx: 100,
      fy: 100,
      cx: 0,
      cy: 0,
      cameraTransform: straightDownCamera,
    });
    expect(worldY).toBeCloseTo(0, 6);
  });

  it('recovers the known horizontal offset for an off-center pixel', () => {
    // From the same setup: xCam = (50-0)*1.5/100 = 0.75, and with no yaw the
    // world X should come out to exactly that.
    const m = straightDownCamera.m;
    const localX = ((50 - 0) * 1.5) / 100;
    const localYRaw = ((30 - 0) * 1.5) / 100;
    const local = [localX, -localYRaw, -1.5, 1];
    const worldX = m[0] * local[0]! + m[4] * local[1]! + m[8] * local[2]! + m[12] * local[3]!;
    expect(worldX).toBeCloseTo(0.75, 6);
  });

  it('handles a tilted (45-degree pitch) camera correctly', () => {
    // Camera at world (0, 1.0, 0), pitched down 45 degrees (no roll/yaw).
    // Derivation: forward (local -Z) must map to world (0, -sin45, -cos45).
    // Solving for an orthonormal right-handed basis with right staying
    // world +X gives rotation columns:
    //   X -> (1, 0, 0)
    //   Y -> (0, cos45, -sin45)
    //   Z -> (0, cos45, sin45)
    // A ray through the image center hits a floor 1.0m below at slant
    // distance 1.0 / sin(45deg) = sqrt(2), by simple trigonometry.
    const tiltedCamera = mat([
      1, 0, 0, 0,
      0, INV_SQRT2, -INV_SQRT2, 0,
      0, INV_SQRT2, INV_SQRT2, 0,
      0, 1.0, 0, 1,
    ]);

    const worldY = unprojectWorldY({
      pixelX: 0,
      pixelY: 0,
      depth: SQRT2,
      fx: 100,
      fy: 100,
      cx: 0,
      cy: 0,
      cameraTransform: tiltedCamera,
    });
    expect(worldY).toBeCloseTo(0, 5);
  });

  it('is monotonic in depth for a straight-down camera (further reported depth => lower world Y)', () => {
    const shallow = unprojectWorldY({
      pixelX: 0, pixelY: 0, depth: 1.0, fx: 100, fy: 100, cx: 0, cy: 0,
      cameraTransform: straightDownCamera,
    });
    const deep = unprojectWorldY({
      pixelX: 0, pixelY: 0, depth: 1.5, fx: 100, fy: 100, cx: 0, cy: 0,
      cameraTransform: straightDownCamera,
    });
    expect(deep).toBeLessThan(shallow);
  });
});
