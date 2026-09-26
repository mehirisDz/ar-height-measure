/**
 * Reference implementation of the pinhole-camera depth unprojection used by
 * modules/arkit-height-tracker/ios/DepthSampler.swift (see `DepthMath` in
 * that file). The native code processes real ARKit CVPixelBuffers and can't
 * be executed outside Xcode/a device, so this TypeScript twin exists purely
 * to let the underlying coordinate math be unit-tested in plain Node — see
 * __tests__/depthMath.test.ts. If you change the formula here, update the
 * Swift copy (and vice versa); they are meant to stay byte-for-byte
 * equivalent in what they compute.
 *
 * Convention (matches ARKit): camera-local space has +X right, +Y up,
 * and the camera looks down its own -Z axis. Image/pixel space has +Y (row)
 * increasing downward. `cameraTransform` is the camera's 4x4
 * camera-to-world matrix (ARFrame.camera.transform), gravity-aligned so its
 * translation's Y component is the phone's true height above wherever
 * world Y=0 is.
 */

export interface Mat4ColumnMajor {
  /** 16 values, column-major (matches simd_float4x4's memory layout). */
  m: readonly [
    number, number, number, number,
    number, number, number, number,
    number, number, number, number,
    number, number, number, number,
  ];
}

export function unprojectWorldY(params: {
  pixelX: number;
  pixelY: number;
  depth: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  cameraTransform: Mat4ColumnMajor;
}): number {
  const { pixelX, pixelY, depth, fx, fy, cx, cy, cameraTransform } = params;

  const xCam = ((pixelX - cx) * depth) / fx;
  const yCamRaw = ((pixelY - cy) * depth) / fy;
  // Sign flip: image-space +Y (down) maps to camera-space -Y (down is
  // negative in a Y-up frame).
  const localPoint = [xCam, -yCamRaw, -depth, 1] as const;

  const m = cameraTransform.m;
  // Column-major 4x4 * column vector: world = M * local.
  const worldY =
    m[1] * localPoint[0] + m[5] * localPoint[1] + m[9] * localPoint[2] + m[13] * localPoint[3];

  return worldY;
}
