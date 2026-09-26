# AR Height Measure — core measurement engine

Measures how high an iPhone is above the floor, in centimeters, using ARKit
world tracking (+ LiDAR where available) as the primary sensor. This repo is
the **measurement engine only** — no app UI yet, by design (see
"What's not here" below).

## What this actually does, in one paragraph

ARKit tracks the phone's real position in a 3D coordinate space whose Y-axis
is aligned to gravity. Point the phone at the floor; once a horizontal plane
is detected and ARKit's tracking has been stable for a bit, its world-space
Y coordinate is locked in as "zero height." From then on, `cameraY - floorY`
— filtered to reject noise and smoothed with a Kalman filter — is the
phone's height above the floor, at every frame, regardless of how the phone
is tilted or rotated. LiDAR (where present) gives ARKit better, faster
plane geometry for free, and is additionally sampled directly as a
secondary cross-check during calibration. See `docs/ARCHITECTURE.md` for
the full reasoning, including the parts I'd flag for your own scrutiny.

## Quick start (Windows, no Mac)

You cannot run this in Expo Go — it contains a custom native module, which
Expo Go can't load. You need a **development build**, compiled in the cloud
by EAS Build (Apple hardware, no Mac required on your end):

```bash
npm install -g eas-cli
npm install
eas login
eas build:configure          # links this project to your EAS account
eas build --profile development --platform ios
```

That produces an installable `.ipa`. EAS will offer to register your
iPhone's UDID for you (scan a QR code) and can install straight to the
device. Once installed, run:

```bash
npx expo start --dev-client
```

and open the dev build — it connects to Metro like any other Expo app, so
JS-only changes (which is most of this repo) reload instantly. Only
changes under `modules/arkit-height-tracker/ios/` require a fresh
`eas build`.

**Before you start:** installing a development build on a physical iPhone
requires a **paid Apple Developer Program account** ($99/year). A free
Apple ID is only sufficient if you have a Mac to sideload via Xcode's
personal-team signing — which, per your setup, you don't. Also: the iOS
**Simulator cannot run this at all** — ARKit requires real camera and
motion hardware. `eas.json`'s `development-simulator` profile exists only
for exercising non-AR JS/UI work later; it will report `unsupported_device`
here.

## Project structure

```
modules/arkit-height-tracker/   Native layer — thin ARKit/LiDAR bindings.
  ios/*.swift                     You will not need to edit this. Read
                                   ARCHITECTURE.md if you want to anyway.
  index.ts, *.types.ts             Typed JS surface over the native module.

src/measurement/                The actual engine. Pure TypeScript,
  RobustStats.ts                  fully unit-tested, most of it has zero
  KalmanFilter1D.ts                dependency on React Native/Expo at all.
  SignalFilter.ts
  FloorDetector.ts
  StabilityMonitor.ts
  MotionStillnessMonitor.ts      Wraps expo-sensors DeviceMotion.
  BarometerReader.ts             Wraps expo-sensors Barometer — diagnostic
                                   only, deliberately not used in the math.
  HeightMeasurementEngine.ts     Orchestrator: the public API.
  depthMath.ts                  Reference copy of the native depth-unprojection
                                   formula, kept here purely so it can be
                                   unit-tested (see __tests__/depthMath.test.ts).

src/hooks/useHeightMeasurement.ts   The seam where UI plugs in later.
App.tsx                             A bare dev harness — NOT the app's UI.
__tests__/                          Jest tests for everything in src/measurement.
docs/ARCHITECTURE.md                Full design rationale and trade-offs.
docs/VALIDATION.md                  How to test this against a tape measure.
```

## Running the tests

```bash
npm install
npm test          # Jest, via jest-expo
npm run typecheck # tsc --noEmit
```

**Important, and please read this rather than skipping it:** I built this
in a sandboxed environment with no Xcode, no physical iPhone, and — for
most of the build — no network access to even run `npm install`. Concretely,
that means:

- **Verified by me, for real, right now:** every pure-TypeScript file in
  `src/measurement/` (the filtering, floor-selection, and Kalman-filter
  logic) was executed against hand-derived test cases in this environment
  and passed. I found and fixed one real bug this way (a statistical
  lock-in in the outlier rejection — see the comment above `isOutlier` in
  `RobustStats.ts` and the regression test next to it) before you ever saw
  this code. I also structurally type-checked the entire project, Swift
  files aside, against stub type declarations (since I couldn't reach the
  npm registry to install the real ones) and it's clean.
- **Not verified by me, because I have no way to:** the Swift code
  (`modules/arkit-height-tracker/ios/*.swift`) has never been compiled. It's
  written carefully against Apple's documented ARKit APIs (verified against
  current documentation, not just training-data recall — see
  `docs/ARCHITECTURE.md` for specifics), and its trickiest piece (the LiDAR
  depth-to-world-position math) is a line-for-line port of the formula in
  `depthMath.ts`, which IS tested. But "carefully written against docs" is
  not the same as "compiled and run." The very first thing you should do
  once you have a build on a device is check that it builds at all, and
  then work through `docs/VALIDATION.md`.
- **Real accuracy numbers:** I have none, and wouldn't invent any. Nothing
  in this repo reports a made-up height, a hardcoded fallback, or a
  simulated reading — if ARKit/LiDAR data isn't available, the engine
  reports an explicit unsupported/error state, never a number. What
  accuracy you actually get is for you to measure, which is exactly what
  `docs/VALIDATION.md` is for.

## What's not here (on purpose)

No screens, no camera preview, no styling, no app icon. You asked for the
measurement engine first — `useHeightMeasurement()` is the hook a real UI
would call; `HeightMeasurementEngine` is the class it wraps. Both have a
small, stable public surface (see their doc comments) that a UI can be
built against without needing to know anything about ARKit, filtering, or
calibration state machines.

## Tuning

The numbers most likely to need adjustment once you have real device data
(see `docs/VALIDATION.md`):

- `KalmanFilter1D`'s `accelerationNoise`/`measurementNoiseStdDev` — how
  aggressively the filter smooths vs. how fast it reacts to the phone
  actually moving.
- `FloorDetector`'s observation-count/duration/spread thresholds in
  `src/measurement/types.ts` (`DEFAULT_ENGINE_CONFIG`) — how long/stable
  the floor has to look before it's trusted.
- `MotionStillnessMonitor`'s `stillnessThreshold` — how still "still"
  needs to be.

All of these are constructor parameters / config fields, not buried
constants, specifically so you can tune them without touching the
algorithms.
