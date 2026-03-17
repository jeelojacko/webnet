import { useCallback, useMemo, useState } from 'react';
import type { DerivedQaResult, DerivedObservationRef } from '../engine/qaWorkflow';

export interface QaSelectionState {
  stationId: string | null;
  observationId: number | null;
  sourceLine: number | null;
  origin: 'report' | 'map' | 'suspect' | 'compare' | null;
}

const EMPTY_SELECTION: QaSelectionState = {
  stationId: null,
  observationId: null,
  sourceLine: null,
  origin: null,
};

export const useQaSelection = (derivedResult: DerivedQaResult | null) => {
  const [selection, setSelection] = useState<QaSelectionState>(EMPTY_SELECTION);
  const [pinnedObservationIds, setPinnedObservationIds] = useState<number[]>([]);

  const selectedObservation = useMemo<DerivedObservationRef | null>(() => {
    if (!derivedResult || selection.observationId == null) return null;
    return derivedResult.observationById.get(selection.observationId) ?? null;
  }, [derivedResult, selection.observationId]);

  const selectedStation = useMemo(() => {
    if (!derivedResult || selection.stationId == null) return null;
    return derivedResult.stationById.get(selection.stationId) ?? null;
  }, [derivedResult, selection.stationId]);

  const selectObservation = useCallback(
    (
      observationId: number,
      origin: QaSelectionState['origin'] = 'report',
    ) => {
      const observation = derivedResult?.observationById.get(observationId) ?? null;
      setSelection({
        stationId: null,
        observationId,
        sourceLine: observation?.sourceLine ?? null,
        origin,
      });
    },
    [derivedResult],
  );

  const selectStation = useCallback(
    (
      stationId: string,
      origin: QaSelectionState['origin'] = 'report',
    ) => {
      const station = derivedResult?.stationById.get(stationId) ?? null;
      setSelection({
        stationId,
        observationId: null,
        sourceLine: station?.sourceLines[0] ?? null,
        origin,
      });
    },
    [derivedResult],
  );

  const clearSelection = useCallback(() => {
    setSelection(EMPTY_SELECTION);
  }, []);

  const togglePinnedObservation = useCallback((observationId: number) => {
    setPinnedObservationIds((prev) =>
      prev.includes(observationId)
        ? prev.filter((entry) => entry !== observationId)
        : [...prev, observationId],
    );
  }, []);

  const pinnedObservations = useMemo(
    () =>
      pinnedObservationIds
        .map((observationId) => derivedResult?.observationById.get(observationId) ?? null)
        .filter((row): row is DerivedObservationRef => row != null),
    [derivedResult, pinnedObservationIds],
  );

  const selectNextSuspect = useCallback(() => {
    if (!derivedResult || derivedResult.suspectObservationIds.length === 0) return;
    const currentIndex = derivedResult.suspectObservationIds.indexOf(selection.observationId ?? -1);
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % derivedResult.suspectObservationIds.length;
    selectObservation(derivedResult.suspectObservationIds[nextIndex], 'suspect');
  }, [derivedResult, selectObservation, selection.observationId]);

  const selectPreviousSuspect = useCallback(() => {
    if (!derivedResult || derivedResult.suspectObservationIds.length === 0) return;
    const currentIndex = derivedResult.suspectObservationIds.indexOf(selection.observationId ?? -1);
    const nextIndex =
      currentIndex < 0
        ? derivedResult.suspectObservationIds.length - 1
        : (currentIndex - 1 + derivedResult.suspectObservationIds.length) %
          derivedResult.suspectObservationIds.length;
    selectObservation(derivedResult.suspectObservationIds[nextIndex], 'suspect');
  }, [derivedResult, selectObservation, selection.observationId]);

  return {
    selection,
    selectedObservation,
    selectedStation,
    selectObservation,
    selectStation,
    clearSelection,
    pinnedObservations,
    togglePinnedObservation,
    selectNextSuspect,
    selectPreviousSuspect,
    hasSuspects: (derivedResult?.suspectObservationIds.length ?? 0) > 0,
  };
};
