import React from 'react';
import type {
  CadBounds,
  CadDisplayPrimitive,
  CadGripHandle,
  CadSnapCandidate,
} from '../../engine/cad/cadTypes';
import type {
  DragState,
  ProjectPoint,
  ScreenBox,
  SurveyCadPreviewProps,
  SurveyCadViewport,
} from './SurveyCadPreview.types';

export type ScreenPointFromMouseEvent = (
  _event: React.MouseEvent<SVGElement>,
) => { rect: DOMRect; viewX: number; viewY: number } | null;

type PreviewAccent = { stroke: string; fill: string; text: string } | null;

/**
 * Phase 18Q — background-click routing. An active transform (or any command
 * capturing points) wins over surface/volume/block-insert pick loops, so a
 * MOVE/ROTATE click never leaks into the BLOCK_INSERT repeat loop and
 * inserts a stray block reference. Entity-body clicks already route to the
 * command first via onEntityClick; this covers the background paths.
 */
export const resolveBackgroundClickTarget = (options: {
  commandPointInputActive: boolean;
  surfacePickActive: boolean;
}): 'command' | 'surface' | 'none' => {
  if (options.commandPointInputActive) return 'command';
  if (options.surfacePickActive) return 'surface';
  return 'none';
};

export type SurveyCadPreviewCanvasProps = {
  activeGripDragIdRef: React.MutableRefObject<string | null>;
  activeGripHandleId: string | null;
  activeSnap: CadSnapCandidate | null;
  activeSnapAccent: PreviewAccent;
  baseScale: number;
  commandActive: boolean;
  commandEntityOpacityOverrides: Readonly<Record<string, number>>;
  commandPointInputActive: boolean;
  /** Phase 18F — one-shot inquiry pick (background clicks resolve here). */
  surfacePickActive?: boolean;
  onSurfacePickPoint?: (_worldPoint: { x: number; y: number }) => void;
  /** Phase 18F — surface selection (entity selection untouched). */
  selectedSurfaceId?: string | null;
  onSurfaceClick?: (_surfaceId: string) => void;
  /** Phase 18J — profile-view selection (entity selection untouched). */
  selectedProfileViewId?: string | null;
  onProfileViewClick?: (_viewId: string) => void;
  /**
   * Phase 18K — sample-line + section-view selection. Plan clicks map
   * back to the line resource, view clicks to the view object; CadEntity
   * selection is never touched by either.
   */
  selectedSampleLineId?: string | null;
  onSampleLineClick?: (_groupId: string, _lineId: string) => void;
  selectedSectionViewId?: string | null;
  onSectionViewClick?: (_viewId: string) => void;
  consumeLatchedOrActiveSnap: (_extendMode?: boolean) => boolean;
  didDrag: boolean;
  dragState: DragState;
  gripHandles: readonly CadGripHandle[];
  handlePrimitiveCommandClick: (
    _event: React.MouseEvent<SVGElement>,
    _primitive: CadDisplayPrimitive,
    _sourceSegmentId?: string,
  ) => void;
  handlePrimitiveCommandHover: (
    _event: React.MouseEvent<SVGElement>,
    _primitive: CadDisplayPrimitive,
    _sourceSegmentId?: string,
  ) => void;
  middleMouseDownAtRef: React.MutableRefObject<number>;
  normalized: { minX: number; minY: number };
  onCancelGripEdit: () => void;
  onCommandHoverTargetChange: NonNullable<SurveyCadPreviewProps['onCommandHoverTargetChange']>;
  onConsumeInteractionPoint: SurveyCadPreviewProps['onConsumeInteractionPoint'];
  onEmptyBackgroundDoubleClick?: () => void;
  onFinishGripEdit: (_worldPoint?: { x: number; y: number }) => void;
  onPointerWorldPointChange: SurveyCadPreviewProps['onPointerWorldPointChange'];
  onPrimitiveClickIntercept: SurveyCadPreviewProps['onPrimitiveClickIntercept'];
  onSelectEntities: SurveyCadPreviewProps['onSelectEntities'];
  onSelectEntity: SurveyCadPreviewProps['onSelectEntity'];
  onStartGripEdit: (_handleId: string) => void;
  onViewportChange: (_viewport: SurveyCadViewport) => void;
  onZoomExtents: () => void;
  project: ProjectPoint;
  resolveGripCommitPoint: (_rawWorldPoint: { x: number; y: number }) => { x: number; y: number };
  scale: number;
  scene: SurveyCadPreviewProps['scene'];
  screenPointFromMouseEvent: ScreenPointFromMouseEvent;
  selectedEntityIds: readonly string[];
  selectionBox: ScreenBox | null;
  setArmedSnap: React.Dispatch<React.SetStateAction<CadSnapCandidate | null>>;
  setDidDrag: React.Dispatch<React.SetStateAction<boolean>>;
  setDragState: React.Dispatch<React.SetStateAction<DragState>>;
  snapToleranceScreenUnits: number;
  transientPreviewPrimitives: readonly CadDisplayPrimitive[];
  unproject: (_x: number, _y: number) => { x: number; y: number };
  updateGripDragInteraction: (_rawWorldPoint: { x: number; y: number }, _shiftKey: boolean) => void;
  viewport: SurveyCadViewport;
  visibleWorldBounds: CadBounds | null;
};
