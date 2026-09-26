import type {
  NativePlaneInfo,
  NativeTrackingState,
  PlaneClassification,
  PlaneClassificationStatus,
} from '../../modules/arkit-height-tracker';

export type { NativeTrackingState, PlaneClassification, PlaneClassificationStatus };

/**
 * A horizontal plane candidate, augmented with the bookkeeping FloorDetector
 * needs (when it first appeared, when it last updated) on top of what the
 * native layer reports.
 */
export interface PlaneCandidate extends NativePlaneInfo {
  firstSeenAt: number;
  lastUpdatedAt: number;
}

/**
 * Coarse-grained states the engine moves through. UI (added later) should
 * treat this as the source of truth for what to show the user.
 */
export type EngineState =
  | 'idle'
  | 'unsupported_device'
  | 'starting'
  | 'awaiting_tracking_stability'
  | 'searching_for_floor'
  | 'validating_floor'
  | 'calibrated'
  | 'measuring'
  | 'tracking_lost'
  | 'floor_lost'
  | 'needs_recalibration'
  | 'session_error';

export type MeasurementQuality = 'high' | 'medium' | 'low';

export interface MeasurementReading {
  heightCm: number;
  timestamp: number;
  quality: MeasurementQuality;
  /** Filtered camera Y (meters) that produced this reading, for debugging/logging. */
  filteredCameraY: number;
  /** Raw, unfiltered camera Y (meters) at this instant, for debugging/logging. */
  rawCameraY: number;
  /** Locked floor Y (meters) this reading is measured against. */
  floorY: number;
  /** Estimated 1-sigma uncertainty of filteredCameraY, in meters (from the Kalman filter). */
  uncertaintyMeters: number;
  /** True once the device has been judged still enough that this reading is trustworthy to record. */
  isStable: boolean;
}

export interface EngineSnapshot {
  state: EngineState;
  reading: MeasurementReading | null;
  /** Human-readable reason for the current state, when not self-explanatory. */
  reason?: string;
  capabilities: {
    lidar: boolean;
    planeClassification: boolean;
  } | null;
}

export interface EngineConfig {
  /** Minimum time (ms) tracking must stay 'normal' before we start searching for a floor. */
  minTrackingNormalDurationMs: number;
  /** Minimum consecutive validated floor observations before locking the floor. */
  minFloorObservations: number;
  /** Minimum time span (ms) the floor observations must cover before locking. */
  minFloorValidationDurationMs: number;
  /** Rolling window size (samples) for the camera-Y signal filter. */
  filterWindowSize: number;
  /** Hampel outlier threshold, in modified z-score units. */
  outlierThreshold: number;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  minTrackingNormalDurationMs: 800,
  minFloorObservations: 12,
  minFloorValidationDurationMs: 600,
  filterWindowSize: 20,
  outlierThreshold: 3.5,
};
