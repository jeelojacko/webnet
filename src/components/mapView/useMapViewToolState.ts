import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  buildStationIdLookup,
  resolveStationIdToken,
} from '../../engine/resultDerivedModels';
import type { Map3DCamera } from '../../engine/map3d';
import type { StationMap } from '../../types';
import type { MapToolPanel } from './MapViewContextMenu';
import type { MapToolPickTarget } from './MapViewToolOverlay';
import {
  buildMapToolHighlights,
  buildMapToolMetrics,
  type MapToolHighlights,
  type MapToolMetrics,
} from './mapViewSelectors';

interface MapViewToolSnapshot {
  camera3d: Map3DCamera | null;
  activeTool: MapToolPanel;
  inverseFromInput: string;
  inverseToInput: string;
  anglePivotInput: string;
  angleFromInput: string;
  angleToInput: string;
}

export interface UseMapViewToolStateOptions {
  snapshot: MapViewToolSnapshot | null;
  stations: StationMap;
  visibleStationIds: string[];
  onCloseContextMenu: () => void;
}

export interface MapViewToolState {
  activeTool: MapToolPanel;
  angleBetween: MapToolMetrics['angleBetween'];
  angleFromId: string | null;
  angleFromInput: string;
  anglePivotId: string | null;
  anglePivotInput: string;
  angleToId: string | null;
  angleToInput: string;
  applyPickedToolStation: (_stationId: string) => void;
  closeTool: () => void;
  clearToolPickTarget: () => void;
  highlightedToolSegments: MapToolHighlights['highlightedSegments'];
  highlightedToolStationIds: MapToolHighlights['highlightedStationIds'];
  inverse: MapToolMetrics['inverse'];
  inverseFromId: string | null;
  inverseFromInput: string;
  inverseToId: string | null;
  inverseToInput: string;
  openTool: (_tool: Exclude<MapToolPanel, 'none'>) => void;
  setAngleFromInput: (_value: string) => void;
  setAnglePivotInput: (_value: string) => void;
  setAngleToInput: (_value: string) => void;
  setInverseFromInput: (_value: string) => void;
  setInverseToInput: (_value: string) => void;
  toggleToolPickTarget: (_target: MapToolPickTarget) => void;
  toolPickTarget: MapToolPickTarget | null;
}

export const useMapViewToolState = (options: UseMapViewToolStateOptions): MapViewToolState => {
  const { onCloseContextMenu, snapshot, stations, visibleStationIds } = options;
  const [activeTool, setActiveTool] = useState<MapToolPanel>(() => snapshot?.activeTool ?? 'none');
  const [toolPickTarget, setToolPickTarget] = useState<MapToolPickTarget | null>(null);
  const [inverseFromInput, setInverseFromInput] = useState(() => snapshot?.inverseFromInput ?? '');
  const [inverseToInput, setInverseToInput] = useState(() => snapshot?.inverseToInput ?? '');
  const [anglePivotInput, setAnglePivotInput] = useState(() => snapshot?.anglePivotInput ?? '');
  const [angleFromInput, setAngleFromInput] = useState(() => snapshot?.angleFromInput ?? '');
  const [angleToInput, setAngleToInput] = useState(() => snapshot?.angleToInput ?? '');

  const stationIdLookup = useMemo(() => buildStationIdLookup(visibleStationIds), [visibleStationIds]);
  const resolveStationId = useCallback(
    (value: string): string | null => resolveStationIdToken(stationIdLookup, value),
    [stationIdLookup],
  );

  useEffect(() => {
    if (visibleStationIds.length === 0) {
      setInverseFromInput('');
      setInverseToInput('');
      setAnglePivotInput('');
      setAngleFromInput('');
      setAngleToInput('');
      return;
    }
    if (inverseFromInput.trim() === '') setInverseFromInput(visibleStationIds[0]);
    if (inverseToInput.trim() === '')
      setInverseToInput(visibleStationIds[Math.min(1, visibleStationIds.length - 1)]);
    if (anglePivotInput.trim() === '') setAnglePivotInput(visibleStationIds[0]);
    if (angleFromInput.trim() === '')
      setAngleFromInput(visibleStationIds[Math.min(1, visibleStationIds.length - 1)]);
    if (angleToInput.trim() === '')
      setAngleToInput(visibleStationIds[Math.min(2, visibleStationIds.length - 1)]);
  }, [
    angleFromInput,
    anglePivotInput,
    angleToInput,
    inverseFromInput,
    inverseToInput,
    visibleStationIds,
  ]);

  useEffect(() => {
    if (activeTool === 'none' || visibleStationIds.length === 0) {
      setToolPickTarget(null);
    }
  }, [activeTool, visibleStationIds.length]);

  const inverseFromId = resolveStationId(inverseFromInput);
  const inverseToId = resolveStationId(inverseToInput);
  const anglePivotId = resolveStationId(anglePivotInput);
  const angleFromId = resolveStationId(angleFromInput);
  const angleToId = resolveStationId(angleToInput);

  const { inverse, angleBetween } = useMemo(
    () =>
      buildMapToolMetrics({
        stations,
        inverseFromId,
        inverseToId,
        anglePivotId,
        angleFromId,
        angleToId,
      }),
    [angleFromId, anglePivotId, angleToId, inverseFromId, inverseToId, stations],
  );
  const {
    highlightedStationIds: highlightedToolStationIds,
    highlightedSegments: highlightedToolSegments,
  } = useMemo(
    () =>
      buildMapToolHighlights({
        activeTool,
        inverseFromId,
        inverseToId,
        anglePivotId,
        angleFromId,
        angleToId,
      }),
    [activeTool, angleFromId, anglePivotId, angleToId, inverseFromId, inverseToId],
  );

  const openTool = useCallback(
    (tool: Exclude<MapToolPanel, 'none'>) => {
      setActiveTool(tool);
      setToolPickTarget(null);
      onCloseContextMenu();
    },
    [onCloseContextMenu],
  );

  const closeTool = useCallback(() => {
    setActiveTool('none');
    setToolPickTarget(null);
  }, []);

  const clearToolPickTarget = useCallback(() => {
    setToolPickTarget(null);
  }, []);

  const toggleToolPickTarget = useCallback((target: MapToolPickTarget) => {
    setToolPickTarget((current) => (current === target ? null : target));
  }, []);

  const applyPickedToolStation = useCallback((stationId: string) => {
    if (toolPickTarget === 'inverse-from') {
      setInverseFromInput(stationId);
    } else if (toolPickTarget === 'inverse-to') {
      setInverseToInput(stationId);
    } else if (toolPickTarget === 'angle-pivot') {
      setAnglePivotInput(stationId);
    } else if (toolPickTarget === 'angle-from') {
      setAngleFromInput(stationId);
    } else if (toolPickTarget === 'angle-to') {
      setAngleToInput(stationId);
    }
    setToolPickTarget(null);
  }, [toolPickTarget]);

  return {
    activeTool,
    angleBetween,
    angleFromId,
    angleFromInput,
    anglePivotId,
    anglePivotInput,
    angleToId,
    angleToInput,
    applyPickedToolStation,
    clearToolPickTarget,
    closeTool,
    highlightedToolSegments,
    highlightedToolStationIds,
    inverse,
    inverseFromId,
    inverseFromInput,
    inverseToId,
    inverseToInput,
    openTool,
    setAngleFromInput,
    setAnglePivotInput,
    setAngleToInput,
    setInverseFromInput,
    setInverseToInput,
    toggleToolPickTarget,
    toolPickTarget,
  };
};
