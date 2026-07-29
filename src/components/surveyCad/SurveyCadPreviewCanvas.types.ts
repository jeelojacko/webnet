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

export type SurveyCadPreviewCanvasProps = {
  activeGripDragIdRef: React.MutableRefObject<string | null>;
  activeGripHandleId: string | null;
  activeSnap: CadSnapCandidate | null;
  activeSnapAccent: PreviewAccent;
  baseScale: number;
  commandActive: boolean;
  commandEntityOpacityOverrides: Readonly<Record<string, number>>;
  commandPointInputActive: boolean;
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
