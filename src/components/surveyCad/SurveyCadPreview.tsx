import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CadDisplayPrimitive, CadSnapCandidate } from '../../engine/cad/cadTypes';
import { cadClosestPointOnArc } from '../../engine/cad/cadGeometry';
import {
  GRIP_SNAP_COMMIT_EPSILON,
  SNAP_ACCENT_BY_KIND,
  SNAP_TOLERANCE_SCREEN_MIN_UNITS,
  SNAP_TOLERANCE_SCREEN_UNITS,
} from './SurveyCadPreview.constants';
import {
  screenPointFromClientPoint,
  useProjector,
  visibleWorldBoundsFromViewport,
} from './SurveyCadPreview.geometry';
import SurveyCadPreviewCanvas from './SurveyCadPreviewCanvas';
import { SurveyCadParcelReportOverlay } from './SurveyCadParcelReportOverlay';
import {
  SurveyCadCommandHelpOverlay,
  SurveyCadCommandInputBar,
  SurveyCadSnapBadge,
  SurveyCadSnapControls,
} from './SurveyCadPreviewOverlays';
import type { DragState, SurveyCadPreviewProps } from './SurveyCadPreview.types';

const SurveyCadPreview: React.FC<SurveyCadPreviewProps> = ({
  scene,
  viewBounds,
  selectedEntityIds,
  selectedParcelReport,
  showParcelLabels = true,
  hasTopRightOverlay = false,
  activeSnap,
  commandPreviewPrimitives,
  gripHandles = [],
  gripPreviewPrimitives = [],
  activeGripHandleId = null,
  commandStatusText,
  commandHelpText,
  commandModifierHint,
  constructionHint,
  snapPreferences,
  commandInputValue,
  commandInputPlaceholder,
  commandInputEnabled,
  commandEntityOpacityOverrides = {},
  viewport,
  commandActive,
  commandPointInputActive,
  onViewportChange,
  onPrimitiveClickIntercept,
  onSelectEntity,
  onSelectEntities,
  onStartGripEdit = () => undefined,
  onUpdateGripEdit = () => undefined,
  onFinishGripEdit = () => undefined,
  onCancelGripEdit = () => undefined,
  onConsumeInteractionPoint,
  onPointerWorldPointChange,
  onToggleParcelLabels = () => undefined,
  onCommandHoverTargetChange = () => undefined,
  onSnapPreferenceChange,
  onCommandInputChange,
  onCommandInputEnter,
  onCommandInputEscape,
  onEmptyBackgroundDoubleClick,
  onZoomExtents,
}) => {
  const { baseScale, normalized, project, scale, unproject } = useProjector(viewBounds, viewport);
  const visibleWorldBounds = useMemo(() => visibleWorldBoundsFromViewport(unproject), [unproject]);
  const snapToleranceScreenUnits = useMemo(
    () =>
      Math.max(
        SNAP_TOLERANCE_SCREEN_MIN_UNITS,
        SNAP_TOLERANCE_SCREEN_UNITS - Math.max(0, Math.log2(Math.max(viewport.zoom, 1))) * 2.2,
      ),
    [viewport.zoom],
  );
  const [dragState, setDragState] = useState<DragState>({ kind: 'none' });
  const [didDrag, setDidDrag] = useState(false);
  const [snapMenuOpen, setSnapMenuOpen] = useState(false);
  const selectionBox = dragState.kind === 'box' ? dragState.box : null;
  const middleMouseDownAtRef = useRef<number>(0);
  const activeGripDragIdRef = useRef<string | null>(null);
  const [armedSnap, setArmedSnap] = useState<CadSnapCandidate | null>(null);
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const activeSnapRef = useRef<CadSnapCandidate | null>(activeSnap);
  const activeSnapAccent = activeSnap ? SNAP_ACCENT_BY_KIND[activeSnap.kind] : null;
  const transientPreviewPrimitives = useMemo(
    () => [...commandPreviewPrimitives, ...gripPreviewPrimitives],
    [commandPreviewPrimitives, gripPreviewPrimitives],
  );

  React.useEffect(() => {
    if (!commandInputEnabled) return;
    commandInputRef.current?.focus();
  }, [commandInputEnabled, commandActive]);

  useEffect(() => {
    activeSnapRef.current = activeSnap;
  }, [activeSnap]);

  const resolveGripCommitPoint = useCallback((rawWorldPoint: { x: number; y: number }) => {
    const currentSnap = activeSnapRef.current;
    const snapToleranceWorld = snapToleranceScreenUnits / scale;
    if (
      currentSnap &&
      Math.hypot(currentSnap.x - rawWorldPoint.x, currentSnap.y - rawWorldPoint.y) <=
        snapToleranceWorld + GRIP_SNAP_COMMIT_EPSILON
    ) {
      return { x: currentSnap.x, y: currentSnap.y };
    }
    return rawWorldPoint;
  }, [scale, snapToleranceScreenUnits]);

  const updateGripDragInteraction = useCallback(
    (rawWorldPoint: { x: number; y: number }, shiftKey: boolean) => {
      onPointerWorldPointChange(rawWorldPoint, snapToleranceScreenUnits / scale, {
        lockConstruction: shiftKey,
        visibleBounds: visibleWorldBounds,
        restrictedGripHandles: [],
      });
      onUpdateGripEdit(rawWorldPoint);
    },
    [onPointerWorldPointChange, onUpdateGripEdit, scale, snapToleranceScreenUnits, visibleWorldBounds],
  );

  useEffect(() => {
    if (dragState.kind !== 'grip') return;
    const handleWindowMouseMove = (event: MouseEvent) => {
      const svg = document.querySelector('[data-survey-cad-preview]') as SVGElement | null;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const screenPoint = screenPointFromClientPoint(rect, event.clientX, event.clientY);
      if (!screenPoint) return;
      updateGripDragInteraction(unproject(screenPoint.viewX, screenPoint.viewY), event.shiftKey);
    };
    const handleWindowMouseUp = (event: MouseEvent) => {
      if (activeGripDragIdRef.current == null) return;
      const svg = document.querySelector('[data-survey-cad-preview]') as SVGElement | null;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const screenPoint = screenPointFromClientPoint(rect, event.clientX, event.clientY);
      if (!screenPoint) return;
      const rawWorldPoint = unproject(screenPoint.viewX, screenPoint.viewY);
      updateGripDragInteraction(rawWorldPoint, event.shiftKey);
      activeGripDragIdRef.current = null;
      onFinishGripEdit(resolveGripCommitPoint(rawWorldPoint));
      setDidDrag(false);
      setDragState({ kind: 'none' });
    };
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [dragState.kind, onFinishGripEdit, resolveGripCommitPoint, unproject, updateGripDragInteraction]);

  const screenPointFromMouseEvent = (
    event: React.MouseEvent<SVGElement>,
  ): { rect: DOMRect; viewX: number; viewY: number } | null => {
    const svgElement =
      event.currentTarget instanceof SVGSVGElement
        ? event.currentTarget
        : event.currentTarget.ownerSVGElement ?? event.currentTarget;
    return screenPointFromClientPoint(svgElement.getBoundingClientRect(), event.clientX, event.clientY);
  };

  const consumeSnapCandidate = (snapCandidate: CadSnapCandidate, extendMode = false) => {
    onConsumeInteractionPoint(
      { x: snapCandidate.x, y: snapCandidate.y },
      snapCandidate.label,
      {
        snapSourceSegmentId: snapCandidate.sourceSegmentId,
        snapSourceEntityId: snapCandidate.sourceEntityId,
        snapKind: snapCandidate.kind,
        extendMode,
      },
    );
  };

  const consumeLatchedOrActiveSnap = (extendMode = false): boolean => {
    const latchedSnap = armedSnap ?? activeSnap;
    setArmedSnap(null);
    if (!latchedSnap) return false;
    consumeSnapCandidate(latchedSnap, extendMode);
    return true;
  };

  const handlePrimitiveCommandClick = (
    event: React.MouseEvent<SVGElement>,
    primitive: CadDisplayPrimitive,
    sourceSegmentId?: string,
  ) => {
    if (didDrag) return;
    if (consumeLatchedOrActiveSnap(event.shiftKey)) {
      return;
    }
    const screenPoint = screenPointFromMouseEvent(event);
    if (!screenPoint) return;
    const rawWorldPoint = unproject(screenPoint.viewX, screenPoint.viewY);
    if (primitive.kind === 'arc') {
      onConsumeInteractionPoint(
        cadClosestPointOnArc(
          rawWorldPoint,
          primitive.center,
          primitive.radius,
          primitive.startAngleDeg,
          primitive.endAngleDeg,
        ),
        undefined,
        {
          snapSourceSegmentId: sourceSegmentId,
          snapSourceEntityId: primitive.sourceEntityId,
          snapKind: 'nearest',
          extendMode: event.shiftKey,
        },
      );
      return;
    }
    onConsumeInteractionPoint(rawWorldPoint, undefined, {
      snapSourceSegmentId: sourceSegmentId,
      snapSourceEntityId: primitive.sourceEntityId,
      extendMode: event.shiftKey,
    });
  };

  const handlePrimitiveCommandHover = (
    event: React.MouseEvent<SVGElement>,
    primitive: CadDisplayPrimitive,
    sourceSegmentId?: string,
  ) => {
    if (!commandPointInputActive) {
      onCommandHoverTargetChange(null);
      return;
    }
    const screenPoint = screenPointFromMouseEvent(event);
    if (!screenPoint) return;
    const rawWorldPoint = unproject(screenPoint.viewX, screenPoint.viewY);
    const point =
      primitive.kind === 'arc'
        ? cadClosestPointOnArc(
            rawWorldPoint,
            primitive.center,
            primitive.radius,
            primitive.startAngleDeg,
            primitive.endAngleDeg,
          )
        : rawWorldPoint;
    onCommandHoverTargetChange({
      entityId: primitive.sourceEntityId,
      segmentId: sourceSegmentId,
      point,
      extendMode: event.shiftKey,
    });
  };

  return (
    <div className="relative h-full w-full bg-slate-950" data-survey-cad-preview-shell>
      <SurveyCadPreviewCanvas
        activeGripDragIdRef={activeGripDragIdRef}
        activeGripHandleId={activeGripHandleId}
        activeSnap={activeSnap}
        activeSnapAccent={activeSnapAccent}
        baseScale={baseScale}
        commandActive={commandActive}
        commandEntityOpacityOverrides={commandEntityOpacityOverrides}
        commandPointInputActive={commandPointInputActive}
        consumeLatchedOrActiveSnap={consumeLatchedOrActiveSnap}
        didDrag={didDrag}
        dragState={dragState}
        gripHandles={gripHandles}
        handlePrimitiveCommandClick={handlePrimitiveCommandClick}
        handlePrimitiveCommandHover={handlePrimitiveCommandHover}
        middleMouseDownAtRef={middleMouseDownAtRef}
        normalized={normalized}
        onCancelGripEdit={onCancelGripEdit}
        onCommandHoverTargetChange={onCommandHoverTargetChange}
        onConsumeInteractionPoint={onConsumeInteractionPoint}
        onEmptyBackgroundDoubleClick={onEmptyBackgroundDoubleClick}
        onFinishGripEdit={onFinishGripEdit}
        onPointerWorldPointChange={onPointerWorldPointChange}
        onPrimitiveClickIntercept={onPrimitiveClickIntercept}
        onSelectEntities={onSelectEntities}
        onSelectEntity={onSelectEntity}
        onStartGripEdit={onStartGripEdit}
        onViewportChange={onViewportChange}
        onZoomExtents={onZoomExtents}
        project={project}
        resolveGripCommitPoint={resolveGripCommitPoint}
        scale={scale}
        scene={scene}
        screenPointFromMouseEvent={screenPointFromMouseEvent}
        selectedEntityIds={selectedEntityIds}
        selectionBox={selectionBox}
        setArmedSnap={setArmedSnap}
        setDidDrag={setDidDrag}
        setDragState={setDragState}
        snapToleranceScreenUnits={snapToleranceScreenUnits}
        transientPreviewPrimitives={transientPreviewPrimitives}
        unproject={unproject}
        updateGripDragInteraction={updateGripDragInteraction}
        viewport={viewport}
        visibleWorldBounds={visibleWorldBounds}
      />
      <SurveyCadCommandHelpOverlay
        commandStatusText={commandStatusText}
        commandHelpText={commandHelpText}
        commandInputEnabled={commandInputEnabled}
        commandModifierHint={commandModifierHint}
        constructionHint={constructionHint}
      />
      <SurveyCadSnapBadge activeSnap={activeSnap} activeSnapAccent={activeSnapAccent} />
      <SurveyCadSnapControls
        snapMenuOpen={snapMenuOpen}
        setSnapMenuOpen={setSnapMenuOpen}
        showParcelLabels={showParcelLabels}
        snapPreferences={snapPreferences}
        onToggleParcelLabels={onToggleParcelLabels}
        onSnapPreferenceChange={onSnapPreferenceChange}
      />
      <SurveyCadCommandInputBar
        commandInputRef={commandInputRef}
        commandInputValue={commandInputValue}
        commandInputPlaceholder={commandInputPlaceholder}
        commandInputEnabled={commandInputEnabled}
        onCommandInputChange={onCommandInputChange}
        onCommandInputEnter={onCommandInputEnter}
        onCommandInputEscape={onCommandInputEscape}
      />
      <SurveyCadParcelReportOverlay
        selectedParcelReport={selectedParcelReport}
        hasTopRightOverlay={hasTopRightOverlay}
      />
    </div>
  );
};

export default SurveyCadPreview;
