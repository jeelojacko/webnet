import { useEffect, useRef } from 'react';

import type { Map3DCamera } from '../../engine/map3d';
import type { MapToolPanel } from './MapViewContextMenu';
import { type View2dState, view2dEquals } from './mapView2d';

export interface MapViewSnapshotValue {
  view2d: View2dState;
  camera3d: Map3DCamera | null;
  activeTool: MapToolPanel;
  inverseFromInput: string;
  inverseToInput: string;
  anglePivotInput: string;
  angleFromInput: string;
  angleToInput: string;
  showTransformedCoordinates: boolean;
  showLabels: boolean;
  hideMinorGeometry: boolean;
  focusSelection: boolean;
}

export interface UseMapViewSnapshotSyncOptions extends Omit<MapViewSnapshotValue, 'view2d'> {
  effectiveMode: '2d' | '3d';
  interactionPhase: 'idle' | 'interacting' | 'settling';
  initialView2d: View2dState;
  onSnapshotChange?: (_snapshot: MapViewSnapshotValue) => void;
  view2d: View2dState;
}

const snapshotEquals = (
  previousSnapshot: MapViewSnapshotValue,
  nextSnapshot: MapViewSnapshotValue,
): boolean =>
  view2dEquals(previousSnapshot.view2d, nextSnapshot.view2d) &&
  previousSnapshot.camera3d === nextSnapshot.camera3d &&
  previousSnapshot.activeTool === nextSnapshot.activeTool &&
  previousSnapshot.inverseFromInput === nextSnapshot.inverseFromInput &&
  previousSnapshot.inverseToInput === nextSnapshot.inverseToInput &&
  previousSnapshot.anglePivotInput === nextSnapshot.anglePivotInput &&
  previousSnapshot.angleFromInput === nextSnapshot.angleFromInput &&
  previousSnapshot.angleToInput === nextSnapshot.angleToInput &&
  previousSnapshot.showTransformedCoordinates === nextSnapshot.showTransformedCoordinates &&
  previousSnapshot.showLabels === nextSnapshot.showLabels &&
  previousSnapshot.hideMinorGeometry === nextSnapshot.hideMinorGeometry &&
  previousSnapshot.focusSelection === nextSnapshot.focusSelection;

export const useMapViewSnapshotSync = (options: UseMapViewSnapshotSyncOptions): void => {
  const {
    activeTool,
    angleFromInput,
    anglePivotInput,
    angleToInput,
    camera3d,
    effectiveMode,
    focusSelection,
    hideMinorGeometry,
    initialView2d,
    interactionPhase,
    inverseFromInput,
    inverseToInput,
    onSnapshotChange,
    showLabels,
    showTransformedCoordinates,
    view2d,
  } = options;
  const stableSnapshotView2dRef = useRef(initialView2d);
  const lastEmittedSnapshotRef = useRef<MapViewSnapshotValue | null>(null);

  useEffect(() => {
    if (effectiveMode !== '2d' || interactionPhase !== 'idle') return;
    stableSnapshotView2dRef.current = view2d;
  }, [effectiveMode, interactionPhase, view2d]);

  useEffect(() => {
    if (!onSnapshotChange) return;
    const nextSnapshot: MapViewSnapshotValue = {
      view2d: effectiveMode === '2d' ? stableSnapshotView2dRef.current : view2d,
      camera3d,
      activeTool,
      inverseFromInput,
      inverseToInput,
      anglePivotInput,
      angleFromInput,
      angleToInput,
      showTransformedCoordinates,
      showLabels,
      hideMinorGeometry,
      focusSelection,
    };
    const previousSnapshot = lastEmittedSnapshotRef.current;
    if (previousSnapshot != null && snapshotEquals(previousSnapshot, nextSnapshot)) return;
    lastEmittedSnapshotRef.current = nextSnapshot;
    onSnapshotChange(nextSnapshot);
  }, [
    activeTool,
    angleFromInput,
    anglePivotInput,
    angleToInput,
    camera3d,
    effectiveMode,
    focusSelection,
    hideMinorGeometry,
    interactionPhase,
    inverseFromInput,
    inverseToInput,
    onSnapshotChange,
    showLabels,
    showTransformedCoordinates,
    view2d,
  ]);
};
