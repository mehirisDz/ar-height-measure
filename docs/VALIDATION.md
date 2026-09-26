# Validating against a tape measure

This engine has never been tested against a physical measurement — that can
only happen on a real device, which I don't have access to. Here's a
concrete protocol for doing it once you have a development build installed.

## 0. Sanity checks first (in this order)

1. **Does it build at all?** `eas build --profile development --platform
   ios`. If the Swift fails to compile, that's useful information on its
   own — check `getCapabilities()`/the build log against
   `docs/ARCHITECTURE.md` section 8 before assuming the whole approach is
   wrong; it's more likely a single API surface mismatch.
2. **Does `getCapabilities()` report what you expect?** On an iPhone 12 Pro
   or later Pro model (or any LiDAR iPad Pro), `sceneDepth` should be
   `true`. On any non-Pro iPhone from the last several years, `false` for
   `sceneDepth`, `true` for `planeClassification`.
3. **Does the state machine reach `measuring`?** Using `App.tsx`'s dev
   harness: tap Start, point the phone at an actual floor (not a table),
   hold it fairly still for a couple of seconds. State should move
   `starting → awaiting_tracking_stability → searching_for_floor →
   validating_floor → measuring`. If it gets stuck in
   `searching_for_floor`, the floor likely isn't classifying — check
   `reason` and try a room with more visual texture on the floor (ARKit's
   plane detection needs feature points; a perfectly plain, low-texture
   floor is genuinely harder for it).
4. **LiDAR cross-check, if applicable:** while state is `measuring` and
   the camera is still pointed near the floor, call
   `engine.sampleFloorDepthCrossCheck()`. `agreesWithLock` should be
   `true`. If it's `false`, see `docs/ARCHITECTURE.md` section 5 — this
   isolates whether the bug (if any) is in the depth math or the primary
   plane-based path.

## 1. The actual tape-measure test

Repeat this at least 5-10 times, ideally across a couple of different
rooms/floor surfaces:

1. Lay a tape measure vertically against a wall, or have a second person
   hold it.
2. Start the engine, calibrate (point at floor, wait for `measuring`).
3. Raise the phone to a specific, repeatable height — e.g. flush against
   the underside of your outstretched hand, or resting the phone's bottom
   edge against a specific mark.
4. Read the tape measure at that exact point at the same moment.
5. Record: tape reading, `reading.heightCm`, `reading.quality`,
   `reading.uncertaintyMeters`, `reading.isStable`, and whether LiDAR was
   available (`capabilities.lidar`).
6. Hold still for 2-3 seconds and watch whether `heightCm` stays put
   (this is what `isStable`/`uncertaintyMeters` are supposed to reflect —
   if it says stable/low-uncertainty but is visibly still drifting, the
   Kalman filter's parameters need retuning, see below).

## 2. What to do with the results

- **Consistent offset (e.g. always ~2cm too high):** likely a systematic
  calibration issue — check whether the floor plane's classified/heuristic
  Y matches the true floor (e.g. compare `reading.floorY` across repeats;
  it should be essentially identical if you're in the same spot).
- **Random scatter with no consistent bias:** this is what the Kalman
  filter's `measurementNoiseStdDev` should be tuned against — if the
  scatter across repeats is bigger than the default assumes (4mm), increase
  it; the filter will smooth harder at the cost of reacting more slowly to
  genuine motion.
- **Slow to settle / lags visibly when you stop raising the phone:**
  decrease `accelerationNoise` in `KalmanFilter1D`'s constructor call
  inside `SignalFilter`.
- **`quality` stuck at `'low'` even when it looks stable:** check which
  condition in `HeightMeasurementEngine.computeQuality()` isn't being met —
  most likely `lockedFloorWasClassified` is `false` (no plane
  classification on this device/surface) or `uncertaintyMeters` isn't
  dropping as low as the `'high'` threshold expects; either retune the
  threshold or treat `'medium'` as the realistic ceiling on devices without
  classification.

## 3. Recording results for future tuning

There's no telemetry/logging pipeline in this repo yet — that's
appropriately a UI/product decision, not something to bake into the engine
unasked. For now, the dev harness's on-screen numbers plus your own notes
are the source of truth. If accuracy tuning becomes an ongoing thing,
consider adding a simple local log (timestamp, heightCm, quality,
uncertaintyMeters, tape reading) written to a file for later analysis — the
`EngineSnapshot` you get from `subscribe()` has everything needed for that
already.
