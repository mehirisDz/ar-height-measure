# Architecture and design rationale

## 1. The core physical principle

`ARWorldTrackingConfiguration.worldAlignment` defaults to `.gravity`
(confirmed against current Apple documentation, not assumed): ARKit's world
coordinate system has its Y-axis parallel to gravity, origin at wherever
the session started. This is set explicitly in `runSession()` even though
it's the default, because the entire measurement approach depends on it.

The practical consequence: `ARFrame.camera.transform`'s translation column
gives the phone's position in that fixed, gravity-aligned frame. Its Y
component is the phone's true height above wherever world-Y-zero is —
**regardless of how the phone is tilted, rotated, or held**. No trigonometry
correcting for device orientation is needed anywhere in this codebase,
because we never read a device-local axis; we always read the world-space
Y translation directly. This is why establishing "the floor" is really just
"find a horizontal plane, read its world-space Y, remember that number."

## 2. Why a custom native module instead of an existing library

I looked into this properly rather than assuming. `@reactvision/react-viro`
(ViroReact) has matured substantially — as of its current releases it
exposes classified plane detection (Wall/Floor/Ceiling/Table/Seat/Door/
Window, in the plane-update callbacks), camera transform via
`onCameraTransformUpdate`/`onTrackingUpdated` on `ViroARScene`, is
Expo-native (config plugin, EAS Build compatible), and has some LiDAR
depth access (`depthEnabled` prop enabling depth-based hit-testing, and a
world-mesh subscription API tagging mesh sources as LiDAR/Monocular/Plane).
That's a genuinely valid "existing library" path, and if you'd rather use
it, most of `src/measurement/` (everything except the native-module calls
inside `HeightMeasurementEngine`) would still apply unchanged — it consumes
a plain `{position, planes, trackingState}` shape, not anything
ARKit-specific.

I chose to write a small native module anyway, for three concrete reasons:

1. **Verifiability.** Every API this module calls —
   `ARFrame.camera.transform`, `ARPlaneAnchor.classification` /
   `isClassificationSupported`, `ARFrame.sceneDepth` /
   `ARDepthData.confidenceMap` — I checked against Apple's current
   documentation while building this, not just recalled from training
   data. ViroReact's newer depth/mesh surface is real but far less
   documented; I could not verify its exact JS shape (field names,
   whether confidence is exposed per hit-test result) to the same
   standard. For a system whose top priority is measurement accuracy, I'd
   rather the one piece I can't test on-device be the piece I'm most
   confident is correctly specified.
2. **Fit.** ViroReact is a full 3D/AR/VR rendering engine — physics,
   glTf/GLB loading, multi-headset support. This app has no rendering
   requirement at all right now. That's a lot of dependency weight and
   build complexity for "give me a position and some plane data."
3. **Headless-first.** ViroReact requires a mounted `ViroARSceneNavigator`
   + `ViroARScene` to emit anything — there's no way to run it without a
   live scene component. You asked for the engine to work before any UI
   exists; the native module here runs a headless `ARSession` with no
   view at all.

If you disagree with this call, swapping the native layer for ViroReact
means reimplementing `modules/arkit-height-tracker`'s `index.ts` surface
against Viro's props/callbacks instead of a custom Swift module —
`src/measurement/` doesn't need to change.

## 3. Floor detection and validation

`FloorDetector.ts` + `scoreCandidate()`/`selectFloorCandidate()`:

- Prefers a plane ARKit has confidently classified as `.floor`
  (`classificationStatus == .known`). Confidently classified as something
  *else* (wall/table/ceiling/...) is strongly disqualifying, not just
  ignored.
- On devices/situations without classification, falls back to geometry:
  size (bigger is more likely a real floor than a small object) and
  plausibility (a phone held above one's head is realistically
  15cm–2.6m above the floor — a plane outside that range relative to the
  camera is rejected outright).
- Requires the **same** plane id to win consistently for
  `minFloorObservations` samples spanning `minFloorValidationDurationMs`,
  with the observed Y values tightly clustered (MAD-based spread check),
  before locking a floor. Switching to a different plane id mid-validation
  restarts the window rather than blending two different physical
  surfaces together.
- **Known limitation:** if the floor is carpeted or rugged, ARKit will
  detect (and this will lock onto) the top of that surface — which is
  correct for "height above what you're standing on," but not the
  structural floor underneath if that distinction matters to you. This is
  not something I've tried to solve; it would need a different
  measurement strategy entirely (e.g. explicit rug-thickness input).
- **Known limitation:** moving to a different room/floor/uneven terrain
  mid-session is not auto-detected. Call `recalibrate()` explicitly when
  the user changes location — the engine has no way to know this on its
  own.

## 4. Filtering: why not a moving average

Two things happen to every incoming camera-Y sample before it's trusted
(`SignalFilter.ts`):

1. **Outlier rejection** (`RobustStats.isOutlier`): a rolling-window,
   median/MAD-based test (the Iglewicz-Hoaglin modified z-score) rejects
   single-frame spikes before they can affect anything downstream. I
   floor the MAD at the assumed sensor-noise level rather than letting it
   collapse toward zero from a small/lopsided sample — **this was a real
   bug I found and fixed while building this**, not a defensive
   afterthought: an early version's outlier test could get statistically
   "stuck" rejecting perfectly normal alternating jitter forever, once a
   short window happened to have a slight majority for one value (MAD hit
   exactly 0, sending the z-score to infinity for the minority side,
   which then never entered the window to correct it — a self-reinforcing
   lock-in). `__tests__/RobustStats.test.ts` has the regression test.
2. **Kalman smoothing** (`KalmanFilter1D.ts`): a standard constant-velocity
   1D Kalman filter (position + velocity state, textbook discretized
   white-noise-acceleration process model) smooths what gets through
   stage 1. This is why raising the phone (a sustained, fast change) is
   tracked with only small lag rather than being smoothed away like a
   moving average would.
3. **Re-baselining**: if several samples in a row get rejected by stage 1,
   that's treated as evidence of *real, sustained motion* the rolling
   window has simply fallen behind on — not sensor malfunction — and the
   window is cleared so the filter can re-lock onto the new region
   immediately, rather than fighting its way there sample by sample.

All three pieces are covered by tests that actually run (see the "what's
verified" section of the README) — including a test that specifically
checks the filter does *not* get stuck when a real, fast motion happens.

## 5. LiDAR: primary vs. secondary use

ARKit **automatically** uses LiDAR internally to improve plane-detection
speed and accuracy on supported devices — this happens for free, without
this codebase touching `sceneDepth` at all, just by enabling
`.horizontal` plane detection on a LiDAR device. That's the main way LiDAR
helps here.

On top of that, `DepthSampler.swift` takes one additional, explicit use of
raw LiDAR depth: during calibration (while the camera is pointed at the
floor), it scans the depth map, keeps only `.high`-confidence pixels
(`ARConfidenceLevel`), unprojects each into a world-space point using the
standard pinhole-camera formula, and reports the median world-Y plus how
tightly clustered the accepted samples were.

This is deliberately a **secondary, cross-check signal** — exposed via
`sampleFloorDepthCrossCheck()` — not something the primary
`cameraY - floorY` calculation depends on. Reasoning: the coordinate math
involved (pixel → camera space → world space, with the correct sign
conventions for ARKit's axis layout) is real and correct to the best of my
derivation and testing, but it's Swift, running against real
`CVPixelBuffer`s, and I have no way to compile or run it. I mirrored the
exact formula in `depthMath.ts` and unit-tested it against three
hand-derived camera/depth configurations (straight-down, off-center pixel,
45°-tilted camera) — all three check out arithmetically. That gives me
real confidence in the *math*. It does not give me confidence in things
that can only surface at runtime: pixel-format assumptions
(`kCVPixelFormatType_DepthFloat32` / `OneComponent8`, matching current
documentation), buffer stride handling, or intrinsics scaling between the
depth map's resolution and the camera image's. Treating this as a
corroborating signal rather than the primary path means a bug here shows
up as "the cross-check disagrees, investigate" rather than silently
corrupting the reported height.

**First thing to check on a real device:** call
`sampleFloorDepthCrossCheck()` while pointed at the floor and confirm
`agreesWithLock` is true / the disagreement is within a centimeter or two.
If it isn't, the bug is almost certainly in `DepthSampler.swift`'s pixel
buffer handling (not the math — that part's tested) or in a pixel-format
assumption that's since changed.

## 6. Why the barometer isn't used in the calculation

`BarometerReader.ts` reads the real sensor (via `expo-sensors`' `Barometer`,
which is `CMAltimeter`-backed) and exposes it — but nothing consumes it in
the height calculation. Barometric relative altitude is built and
calibrated to resolve building-scale changes (one floor to the next, tens
of meters) over integration windows of tens of seconds to minutes; at the
sub-2m, few-second, centimeter-precision scale this app operates at, it
would add weather/HVAC-driven drift, not signal. If you want to experiment
with it later (e.g. a coarse plausibility check, or a much longer
capture window), the real data is there to use — I just didn't wire it
into a system where it can only hurt.

## 7. Session interruptions and coordinate continuity

`ARSession` can be interrupted (phone call, backgrounding, Control Center).
When an interruption ends, ARKit does not guarantee it relocalizes to
exactly the same coordinate origin. Rather than silently trusting a
possibly-stale floor lock after an interruption, the engine treats
"interruption ended" as "needs recalibration" and clears the lock. Same
logic for a plane-anchor removal: ARKit routinely merges overlapping plane
anchors as it refines a surface (removing one anchor, extending another) —
that is not the same as genuinely losing the floor, so the engine first
checks whether a plausible replacement plane still exists near the old
lock's height before declaring `floor_lost`.

## 8. What I could not verify, end to end

Being explicit about this rather than burying it:

- The Swift code has never been compiled. It's written against
  currently-documented Apple APIs, checked during this build (see the
  README's "what's verified" section), but "matches documentation" and
  "compiles and runs correctly" are different claims.
- I have no device to measure real ARKit position noise, real plane
  classification latency, or real LiDAR depth-map resolution/format on a
  current-generation iPhone. The Kalman filter's noise parameters and the
  floor-validation thresholds are reasoned defaults, not measured ones —
  see the README's "Tuning" section and `docs/VALIDATION.md`.
- I have no real accuracy number for this system against a tape measure,
  because that measurement can only happen on a physical device.
