import { useCallback, useMemo, useState } from 'react';
import type { DerivedQaResult, DerivedObservationRef } from '../engine/qaWorkflow';
import type { WorkspaceSelectionState } from '../appStateTypes';

export type QaSelectionState = WorkspaceSelectionState;

const EMPTY_SELECTION: QaSelectionState = {
  stationId: null,
  observationId: null,
  sourceLine: null,
  origin: null,
};

interface UseQaSelectionArgs {
  initialSelection?: QaSelectionState;
  initialPinnedObservationIds?: number[];
}

export const useQaSelection = (
  derivedResult: DerivedQaResult | null,
  {
    initialSelection = EMPTY_SELECTION,
    initialPinnedObservationIds = [],
  }: UseQaSelectionArgs = {},
) => {
  const [selection, setSelection] = useState<QaSelectionState>(initialSelection);
  const [pinnedObservationIds, setPinnedObservationIds] = useState<number[]>(initialPinnedObservationIds);

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

  const restoreSelection = useCallback((nextSelection: QaSelectionState) => {
    setSelection(nextSelection);
  }, []);

  const togglePinnedObservation = useCallback((observationId: number) => {
    setPinnedObservationIds((prev) =>
      prev.includes(observationId)
        ? prev.filter((entry) => entry !== observationId)
        : [...prev, observationId],
    );
  }, []);

  const restorePinnedObservationIds = useCallback((nextObservationIds: number[]) => {
    setPinnedObservationIds(nextObservationIds);
  }, []);

  const clearPinnedObservations = useCallback(() => {
    setPinnedObservationIds([]);
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
    restoreSelection,
    pinnedObservationIds,
    pinnedObservations,
    togglePinnedObservation,
    restorePinnedObservationIds,
    clearPinnedObservations,
    selectNextSuspect,
    selectPreviousSuspect,
    hasSuspects: (derivedResult?.suspectObservationIds.length ?? 0) > 0,
  };
};
