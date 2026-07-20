import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdjustmentResult } from '../../types';
import { noteUiPerfStage, noteUiTabReady } from '../../hooks/useUiPerfMonitor';
import type { PlanningPolygonTarget, ScreenSelectionBox } from './mapViewInteraction';
import type { MapViewSnapshot } from './MapView.types';
import { useMapViewViewportWidth } from './useMapViewShellEffects';

interface UseMapViewRootUiStateArgs {
  result: AdjustmentResult;
  snapshot: MapViewSnapshot | null;
  viewportWidthOverride?: number | undefined;
}

export const useMapViewRootUiState = ({
  result,
  snapshot,
  viewportWidthOverride,
}: UseMapViewRootUiStateArgs) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const obstacleFetchSignatureRef = useRef<string>('');
  const [contextMenu, setContextMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    planningPolygon: PlanningPolygonTarget | null;
  }>({
    open: false,
    x: 0,
    y: 0,
    planningPolygon: null,
  });
  const [showTransformedCoordinates, setShowTransformedCoordinates] = useState(
    () => snapshot?.showTransformedCoordinates ?? false,
  );
  const [showLabels, setShowLabels] = useState(() => snapshot?.showLabels ?? true);
  const [hideMinorGeometry, setHideMinorGeometry] = useState(
    () => snapshot?.hideMinorGeometry ?? false,
  );
  const [focusSelection, setFocusSelection] = useState(() => snapshot?.focusSelection ?? false);
  const [selectionBox, setSelectionBox] = useState<ScreenSelectionBox | null>(null);
  const [viewportWidth, setViewportWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1280,
  );

  useEffect(() => {
    noteUiPerfStage('mapReady');
    noteUiTabReady('map');
  }, [result]);

  useMapViewViewportWidth({ setViewportWidth, viewportWidthOverride });

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, open: false, planningPolygon: null }));
  }, []);

  return {
    closeContextMenu,
    contextMenu,
    contextMenuRef,
    focusSelection,
    hideMinorGeometry,
    obstacleFetchSignatureRef,
    selectionBox,
    setContextMenu,
    setFocusSelection,
    setHideMinorGeometry,
    setSelectionBox,
    setShowLabels,
    setShowTransformedCoordinates,
    showLabels,
    showTransformedCoordinates,
    svgRef,
    viewportWidth,
  };
};
