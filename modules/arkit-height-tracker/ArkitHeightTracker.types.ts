/**
 * Types describing the raw data crossing the JS <-> native boundary.
 * These are intentionally low-level and close to what ARKit itself reports.
 * Interpretation (which plane is "the floor", filtering, calibration) is
 * layered on top in src/measurement/ — nothing here makes those decisions.
 */

export type NativeTrackingState =
  | 'normal'
  | 'notAvailable'
  | 'limited_initializing'
  | 'limited_excessiveMotion'
  | 'limited_insufficientFeatures'
  | 'limited_relocalizing'
  | 'limited_unknown';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface TrackingUpdateEvent {
  timestamp: number;
  trackingState: NativeTrackingState;
  /** Camera (phone) position in ARKit world space, meters, gravity-aligned Y-up. */
  position: Vec3;
  /** World-space forward direction the camera is pointing (unit-ish vector). */
  forward: Vec3;
}

export type PlaneClassification =
  | 'floor'
  | 'wall'
  | 'ceiling'
  | 'table'
  | 'seat'
  | 'door'
  | 'window'
  | 'none'
  | 'unknown';

export type PlaneClassificationStatus = 'known' | 'undetermined' | 'notAvailable' | 'unknown';

export interface NativePlaneInfo {
  id: string;
  /** World-space Y (meters) of the plane's true centroid. */
  worldY: number;
  extentX: number;
  extentZ: number;
  classification: PlaneClassification;
  classificationStatus: PlaneClassificationStatus;
}

export interface PlanesUpdateEvent {
  updated: NativePlaneInfo[];
  /** Plane ids removed/merged away by ARKit since the last event. */
  removed: string[];
}

export interface SessionInterruptionEvent {
  /** true = session was just interrupted; false = interruption just ended. */
  interrupted: boolean;
}

export interface SessionErrorEvent {
  message: string;
  code: number;
}

export interface ArkitHeightTrackerEvents {
  onTrackingUpdate: TrackingUpdateEvent;
  onPlanesUpdate: PlanesUpdateEvent;
  onSessionInterruption: SessionInterruptionEvent;
  onSessionError: SessionErrorEvent;
}

export interface Capabilities {
  worldTracking: boolean;
  planeClassification: boolean;
  sceneDepth: boolean;
  smoothedSceneDepth: boolean;
}

export type FloorDepthSample =
  | {
      available: true;
      worldY: number;
      sampleCount: number;
      spreadMeters: number;
    }
  | {
      available: false;
      reason: string;
      sampleCount?: number;
    };
