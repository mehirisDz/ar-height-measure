import { AppState, type AppStateStatus } from 'react-native';

import * as Native from '../../modules/arkit-height-tracker';
import type {
  NativePlaneInfo,
  PlanesUpdateEvent,
  TrackingUpdateEvent,
} from '../../modules/arkit-height-tracker';
import { BarometerReader } from './BarometerReader';
import { FloorDetector, selectFloorCandidate } from './FloorDetector';
import { MotionStillnessMonitor } from './MotionStillnessMonitor';
import { SignalFilter } from './SignalFilter';
import { StabilityMonitor } from './StabilityMonitor';
import {
  DEFAULT_ENGINE_CONFIG,
  type EngineConfig,
  type EngineSnapshot,
  type EngineState,
  type MeasurementQuality,
  type MeasurementReading,
  type PlaneCandidate,
} from './types';

/** How close (meters) a post-merge replacement candidate must be to the old lock to trust it without re-validating. */
const FLOOR_MERGE_TOLERANCE_METERS = 0.05;

type SnapshotListener = (snapshot: EngineSnapshot) => void;

export class HeightMeasurementEngine {
  private state: EngineState = 'idle';
  private reason: string | undefined;

  private planes = new Map<string, PlaneCandidate>();
  private floorDetector: FloorDetector;
  private stabilityMonitor: StabilityMonitor;
  private heightFilter: SignalFilter;
  private motionMonitor = new MotionStillnessMonitor();
  private barometer = new BarometerReader();

  private lockedFloorId: string | null = null;
  private lockedFloorY: number | null = null;
  private lockedFloorWasClassified = false;

  private lastCameraY: number | null = null;
  private latestReading: MeasurementReading | null = null;
  private capabilities: Native.Capabilities | null = null;

  private trackingSub?: { remove: () => void };
  private planesSub?: { remove: () => void };
  private interruptionSub?: { remove: () => void };
  private errorSub?: { remove: () => void };
  private appStateSub?: { remove: () => void };

  private listeners = new Set<SnapshotListener>();

  constructor(private readonly config: EngineConfig = DEFAULT_ENGINE_CONFIG) {
    this.floorDetector = new FloorDetector(config.minFloorObservations, config.minFloorValidationDurationMs);
    this.stabilityMonitor = new StabilityMonitor(config.minTrackingNormalDurationMs);
    this.heightFilter = new SignalFilter(config.filterWindowSize, config.outlierThreshold);
  }

  // MARK: - Public lifecycle

  async start(): Promise<void> {
    if (this.state !== 'idle' && this.state !== 'session_error' && this.state !== 'unsupported_device') {
      return; // already running
    }

    if (!Native.isSupported()) {
      this.setState('unsupported_device', 'ARKit world tracking is not supported on this device.');
      return;
    }

    this.capabilities = Native.getCapabilities();

    this.trackingSub = Native.addListener('onTrackingUpdate', this.handleTrackingUpdate);
    this.planesSub = Native.addListener('onPlanesUpdate', this.handlePlanesUpdate);
    this.interruptionSub = Native.addListener('onSessionInterruption', this.handleInterruption);
    this.errorSub = Native.addListener('onSessionError', this.handleSessionError);
    this.appStateSub = AppState.addEventListener('change', this.handleAppStateChange);

    this.motionMonitor.start();
    this.barometer.start();

    this.setState('starting');
    try {
      await Native.startSession();
      this.setState('awaiting_tracking_stability');
    } catch (err) {
      this.setState('session_error', err instanceof Error ? err.message : String(err));
    }
  }

  async stop(): Promise<void> {
    await Native.stopSession();
    this.trackingSub?.remove();
    this.planesSub?.remove();
    this.interruptionSub?.remove();
    this.errorSub?.remove();
    this.appStateSub?.remove();
    this.motionMonitor.stop();
    this.barometer.stop();
    this.resetCalibrationState();
    this.setState('idle');
  }

  /** Re-runs floor detection from scratch (new location, or recovering from a lost floor/interruption). */
  async recalibrate(): Promise<void> {
    this.resetCalibrationState();
    this.setState('awaiting_tracking_stability');
    try {
      await Native.resetTracking();
    } catch (err) {
      this.setState('session_error', err instanceof Error ? err.message : String(err));
    }
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): EngineSnapshot {
    return {
      state: this.state,
      reading: this.latestReading,
      reason: this.reason,
      capabilities: this.capabilities
        ? { lidar: this.capabilities.sceneDepth, planeClassification: this.capabilities.planeClassification }
        : null,
    };
  }

  /**
   * One-shot LiDAR depth cross-check of the currently-locked floor, useful
   * while validating/debugging (e.g. against a tape measure — see
   * docs/VALIDATION.md). Only meaningful while the camera is pointed at the
   * floor and a floor is already locked.
   */
  async sampleFloorDepthCrossCheck(): Promise<{ agreesWithLock: boolean; details: Native.FloorDepthSample } | null> {
    if (this.lockedFloorY === null) return null;
    const sample = await Native.sampleFloorDepth();
    if (!sample.available) return { agreesWithLock: false, details: sample };
    const agrees = Math.abs(sample.worldY - this.lockedFloorY) < 0.03;
    return { agreesWithLock: agrees, details: sample };
  }

  // MARK: - Event handlers

  private handleTrackingUpdate = (event: TrackingUpdateEvent): void => {
    this.lastCameraY = event.position.y;
    const stability = this.stabilityMonitor.update(event.trackingState, event.timestamp * 1000);

    if (!stability.isStable) {
      if (this.state === 'measuring' || this.state === 'calibrated') {
        this.setState('tracking_lost', stability.reason);
      } else if (this.state !== 'idle' && this.state !== 'unsupported_device' && this.state !== 'session_error') {
        this.setState('awaiting_tracking_stability', stability.reason);
      }
      this.emitSnapshot();
      return;
    }

    switch (this.state) {
      case 'awaiting_tracking_stability':
        this.setState('searching_for_floor');
        break;

      case 'tracking_lost':
        // Tracking recovered. If we still trust the old floor lock (no
        // interruption/floor-loss happened while it was down), resume
        // measuring directly; otherwise a recalibration was already
        // requested by handleInterruption/handleFloorLost.
        this.setState(this.lockedFloorY !== null ? 'measuring' : 'searching_for_floor');
        break;

      case 'searching_for_floor':
      case 'validating_floor': {
        const candidate = selectFloorCandidate(Array.from(this.planes.values()), event.position.y);
        const result = this.floorDetector.update(candidate, event.timestamp * 1000);
        if (result.isValidated && result.lockedY !== null) {
          this.lockedFloorId = result.candidateId;
          this.lockedFloorY = result.lockedY;
          this.lockedFloorWasClassified =
            (candidate && candidate.classification === 'floor' && candidate.classificationStatus === 'known') ?? false;
          this.heightFilter.reset();
          this.setState('measuring');
        } else {
          this.setState(candidate ? 'validating_floor' : 'searching_for_floor', result.reason);
        }
        break;
      }

      case 'measuring':
        this.updateMeasurement(event.timestamp);
        break;

      default:
        break;
    }

    this.emitSnapshot();
  };

  private handlePlanesUpdate = (event: PlanesUpdateEvent): void => {
    const now = Date.now();
    for (const p of event.updated) {
      this.upsertPlane(p, now);
    }

    if (event.removed.length > 0) {
      for (const id of event.removed) this.planes.delete(id);

      if (this.lockedFloorId !== null && event.removed.includes(this.lockedFloorId)) {
        this.handleLockedFloorAnchorRemoved();
      }
    }
  };

  private handleLockedFloorAnchorRemoved(): void {
    // ARKit routinely merges overlapping plane anchors (removing one,
    // extending another) as it refines its understanding of a surface —
    // that is NOT the same as genuinely losing the floor. Before declaring
    // floor_lost, check whether a plausible replacement candidate still
    // exists near the old lock's height; if so, this was just a merge and
    // we keep measuring against the same locked Y uninterrupted.
    const cameraY = this.lastCameraY ?? this.lockedFloorY ?? 0;
    const replacement = selectFloorCandidate(Array.from(this.planes.values()), cameraY);

    if (replacement && this.lockedFloorY !== null && Math.abs(replacement.worldY - this.lockedFloorY) < FLOOR_MERGE_TOLERANCE_METERS) {
      this.lockedFloorId = replacement.id;
      // Deliberately keep the existing lockedFloorY rather than jumping to
      // the replacement's — it was already validated, and a fresh single
      // reading from the merged anchor is less trustworthy than that.
      return;
    }

    this.lockedFloorId = null;
    this.lockedFloorY = null;
    this.setState('floor_lost', 'locked_floor_anchor_removed_no_replacement');
    this.emitSnapshot();
  }

  private handleInterruption = (event: { interrupted: boolean }): void => {
    if (event.interrupted) return;
    // Interruption just ended. World tracking may not have relocalized to
    // the same coordinate origin, so we do not trust the old floor lock —
    // require recalibration rather than silently risking stale coordinates.
    if (this.lockedFloorY !== null) {
      this.resetCalibrationState();
      this.setState('needs_recalibration', 'session_was_interrupted');
      this.emitSnapshot();
    }
  };

  private handleSessionError = (event: { message: string; code: number }): void => {
    this.setState('session_error', `${event.message} (code ${event.code})`);
    this.emitSnapshot();
  };

  private handleAppStateChange = (next: AppStateStatus): void => {
    if (next !== 'active' && this.state !== 'idle') {
      void this.stop();
    }
  };

  // MARK: - Helpers

  private upsertPlane(info: NativePlaneInfo, now: number): void {
    const existing = this.planes.get(info.id);
    this.planes.set(info.id, {
      ...info,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastUpdatedAt: now,
    });
  }

  private updateMeasurement(timestampSeconds: number): void {
    if (this.lastCameraY === null || this.lockedFloorY === null) return;

    const filterResult = this.heightFilter.update(this.lastCameraY, timestampSeconds);
    const heightMeters = filterResult.value - this.lockedFloorY;
    const isStill = this.motionMonitor.isStill();

    this.latestReading = {
      heightCm: heightMeters * 100,
      timestamp: timestampSeconds,
      quality: this.computeQuality(filterResult.uncertaintyMeters, isStill),
      filteredCameraY: filterResult.value,
      rawCameraY: this.lastCameraY,
      floorY: this.lockedFloorY,
      uncertaintyMeters: filterResult.uncertaintyMeters,
      isStable: isStill && !filterResult.wasOutlier,
    };
  }

  private computeQuality(uncertaintyMeters: number, isStill: boolean): MeasurementQuality {
    if (uncertaintyMeters < 0.004 && isStill && this.lockedFloorWasClassified) return 'high';
    if (uncertaintyMeters < 0.015) return 'medium';
    return 'low';
  }

  private resetCalibrationState(): void {
    this.planes.clear();
    this.floorDetector.reset();
    this.stabilityMonitor.reset();
    this.heightFilter.reset();
    this.lockedFloorId = null;
    this.lockedFloorY = null;
    this.lockedFloorWasClassified = false;
    this.lastCameraY = null;
    this.latestReading = null;
  }

  private setState(next: EngineState, reason?: string): void {
    this.state = next;
    this.reason = reason;
  }

  private emitSnapshot(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
