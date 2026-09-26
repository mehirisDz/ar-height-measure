import { useEffect, useMemo, useRef, useState } from 'react';

import { HeightMeasurementEngine } from '../measurement/HeightMeasurementEngine';
import type { EngineConfig, EngineSnapshot } from '../measurement/types';

export interface UseHeightMeasurementResult extends EngineSnapshot {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  recalibrate: () => Promise<void>;
}

/**
 * React binding for HeightMeasurementEngine. This hook owns the engine's
 * lifecycle for the lifetime of the component that calls it and re-renders
 * on every snapshot update; it does not render anything itself or make any
 * UI decisions — see App.tsx for the (intentionally minimal) dev harness
 * that currently consumes it.
 */
export function useHeightMeasurement(config?: Partial<EngineConfig>): UseHeightMeasurementResult {
  const engineRef = useRef<HeightMeasurementEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new HeightMeasurementEngine(config as EngineConfig | undefined);
  }
  const engine = engineRef.current;

  const [snapshot, setSnapshot] = useState<EngineSnapshot>(() => engine.getSnapshot());

  useEffect(() => {
    const unsubscribe = engine.subscribe(setSnapshot);
    return () => {
      unsubscribe();
      void engine.stop();
    };
    // engine is created once via the ref above and never changes identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useMemo(
    () => ({
      ...snapshot,
      start: () => engine.start(),
      stop: () => engine.stop(),
      recalibrate: () => engine.recalibrate(),
    }),
    [snapshot, engine]
  );
}
