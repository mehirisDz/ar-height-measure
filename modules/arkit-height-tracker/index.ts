import { requireNativeModule } from 'expo';
import type { Subscription } from 'expo-modules-core';

import type {
  ArkitHeightTrackerEvents,
  Capabilities,
  FloorDepthSample,
} from './ArkitHeightTracker.types';

export * from './ArkitHeightTracker.types';

interface NativeArkitHeightTracker {
  isSupported(): boolean;
  getCapabilities(): Capabilities;
  startSession(): Promise<void>;
  stopSession(): Promise<void>;
  resetTracking(): Promise<void>;
  sampleFloorDepth(): Promise<FloorDepthSample>;
  addListener<EventName extends keyof ArkitHeightTrackerEvents>(
    eventName: EventName,
    listener: (event: ArkitHeightTrackerEvents[EventName]) => void
  ): Subscription;
  removeAllListeners(eventName: keyof ArkitHeightTrackerEvents): void;
}

// `requireNativeModule` throws at import time if the native module isn't
// linked into the running binary (e.g. running in Expo Go, or a build that
// predates `expo prebuild` picking this module up). We defer that failure
// to first use instead, so the rest of the JS app (and Metro/jest, which
// never load the native binary at all) can still import this module safely.
let cached: NativeArkitHeightTracker | null = null;
function native(): NativeArkitHeightTracker {
  if (!cached) {
    cached = requireNativeModule<NativeArkitHeightTracker>('ArkitHeightTracker');
  }
  return cached;
}

/**
 * Whether ARKit world tracking is available at all on this device. false on
 * the iOS Simulator and on any device without an A9+ chip (i.e. effectively
 * only relevant as a guard — every physical device this app targets should
 * return true).
 */
export function isSupported(): boolean {
  return native().isSupported();
}

/** Static, device-level capability flags. Safe to call before startSession. */
export function getCapabilities(): Capabilities {
  return native().getCapabilities();
}

/** Starts (or resumes) the headless ARKit world-tracking session. */
export function startSession(): Promise<void> {
  return native().startSession();
}

/** Pauses the ARKit session. Safe to call even if not running. */
export function stopSession(): Promise<void> {
  return native().stopSession();
}

/**
 * Resets world tracking and removes all anchors, establishing a fresh
 * coordinate origin. Use this whenever the floor calibration needs to be
 * redone (new location, tracking recovered from a lost state, etc).
 */
export function resetTracking(): Promise<void> {
  return native().resetTracking();
}

/**
 * Takes a one-shot LiDAR depth+confidence sample of whatever the camera is
 * currently pointed at. Only meaningful while the camera is pointed roughly
 * at the floor. Resolves to `{available: false, reason}` on any
 * non-LiDAR device, or when too few high-confidence pixels were found.
 */
export function sampleFloorDepth(): Promise<FloorDepthSample> {
  return native().sampleFloorDepth();
}

export function addListener<EventName extends keyof ArkitHeightTrackerEvents>(
  eventName: EventName,
  listener: (event: ArkitHeightTrackerEvents[EventName]) => void
): Subscription {
  return native().addListener(eventName, listener);
}
